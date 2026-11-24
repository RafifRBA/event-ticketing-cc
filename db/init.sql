CREATE TYPE ticket_type AS ENUM ('regular', 'vip');

CREATE TABLE tickets (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_name VARCHAR(100) NOT NULL,
  type       ticket_type NOT NULL DEFAULT 'regular',
  price      INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);