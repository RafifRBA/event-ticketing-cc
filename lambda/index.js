// Lambda handler untuk Event Ticketing (Track C: Serverless).
// Alur: Lambda Function URL -> Lambda (Node.js 26.x) -> Amazon S3.
// Penyimpanan: satu objek JSON per tiket, key = tickets/<id>.json.
// AWS SDK v3 sudah tersedia di runtime Node.js 26.x, tidak perlu npm install.
const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  DeleteObjectCommand, ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { randomUUID } = require('crypto');

// Kredensial diambil otomatis dari execution role (LabRole), tidak ada access key di kode.
const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME;           // diisi di Configuration > Environment variables
const PREFIX = 'tickets/';
const TYPES = ['regular', 'vip'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyOf = (id) => `${PREFIX}${id}.json`;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? '' : JSON.stringify(body),
});

function validateTicket({ buyer_name, type, price }) {
  if (typeof buyer_name !== 'string' || !buyer_name.trim()) return 'buyer_name wajib diisi';
  if (!TYPES.includes(type)) return `type harus salah satu dari: ${TYPES.join(', ')}`;
  if (!Number.isInteger(price) || price < 0) return 'price harus bilangan bulat >= 0';
  return null;
}

// Function URL tidak punya routing per route, jadi method + path dicocokkan sendiri.
function route(event) {
  const method = event.requestContext && event.requestContext.http
    ? event.requestContext.http.method : event.httpMethod;
  const path = (event.rawPath || event.path || '/').replace(/\/+$/, '') || '/';
  if (path === '/api/tickets') return { key: `${method} /api/tickets` };
  const m = path.match(/^\/api\/tickets\/([^/]+)$/);
  if (m) return { key: `${method} /api/tickets/{id}`, id: decodeURIComponent(m[1]) };
  return { key: `${method} ${path}` };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(raw); // error ditangkap pemanggil -> 400
}

const isNotFound = (e) =>
  e.name === 'NoSuchKey' || e.name === 'NotFound' ||
  (e.$metadata && e.$metadata.httpStatusCode === 404);

async function putTicket(item) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: keyOf(item.id),
    Body: JSON.stringify(item), ContentType: 'application/json',
  }));
}

async function getTicket(id) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: keyOf(id) }));
  return JSON.parse(await r.Body.transformToString());
}

// List semua key di bawah tickets/ (1 halaman = maks. 1000 key, jadi diulang sampai habis).
async function listTickets() {
  const keys = [];
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: PREFIX, ContinuationToken: token,
    }));
    (r.Contents || []).forEach((o) => keys.push(o.Key));
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  const items = await Promise.all(keys.map(async (Key) => {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
    return JSON.parse(await r.Body.transformToString());
  }));
  return items.sort((a, b) => b.created_at.localeCompare(a.created_at)); // terbaru di atas
}

exports.handler = async (event) => {
  try {
    if (!BUCKET) return json(500, { error: 'BUCKET_NAME belum diset' });
    const { key, id } = route(event);
    let body;
    try { body = parseBody(event); }
    catch { return json(400, { error: 'body bukan JSON valid' }); }

    // id harus UUID; selain itu pasti tidak ada (juga mencegah key aneh seperti "../x").
    if (id !== undefined && !UUID_RE.test(id)) return json(404, { error: 'tiket tidak ditemukan' });

    switch (key) {
      case 'POST /api/tickets': {
        const { buyer_name, type = 'regular', price } = body;
        const error = validateTicket({ buyer_name, type, price });
        if (error) return json(400, { error });
        const item = {
          id: randomUUID(),
          buyer_name: buyer_name.trim(),
          type,
          price,
          created_at: new Date().toISOString(),
        };
        await putTicket(item);
        return json(201, item);
      }

      case 'GET /api/tickets':
        return json(200, await listTickets());

      case 'PUT /api/tickets/{id}': {
        const { buyer_name, type, price } = body;
        const error = validateTicket({ buyer_name, type, price });
        if (error) return json(400, { error });
        const old = await getTicket(id);            // NoSuchKey -> 404 (lihat catch)
        const item = { ...old, buyer_name: buyer_name.trim(), type, price };
        await putTicket(item);
        return json(200, item);
      }

      case 'DELETE /api/tickets/{id}': {
        // DeleteObject di S3 tidak error kalau key tidak ada, jadi cek dulu dengan HeadObject.
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keyOf(id) }));
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: keyOf(id) }));
        return json(204);
      }

      default:
        return json(404, { error: 'route tidak ditemukan' });
    }
  } catch (e) {
    if (isNotFound(e)) return json(404, { error: 'tiket tidak ditemukan' });
    console.error(e);
    return json(500, { error: 'internal error' });
  }
};
