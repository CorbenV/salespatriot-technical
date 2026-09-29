import Fastify from 'fastify';
import { openDb } from './db.js';
import { Ingester } from './ingest.js';
import { getMeta, getSolicitation, listQuerySchema, listSolicitations } from './queries.js';

const PORT = Number(process.env.PORT ?? 3001);
const DB_PATH = process.env.DB_PATH ?? './data/dibbs.sqlite';
const INGEST_INTERVAL_MIN = Number(process.env.INGEST_INTERVAL_MINUTES ?? 60);

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  disableRequestLogging: process.env.LOG_REQUESTS !== 'true',
});
const db = openDb(DB_PATH);
const ingester = new Ingester(db, app.log);

app.get('/api/health', async () => ({ ok: true }));

app.get('/api/meta', async () => ({ ...getMeta(db), ingest: ingester.status }));

app.get('/api/solicitations', async (req, reply) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid query', issues: parsed.error.issues });
  return listSolicitations(db, parsed.data);
});

app.get<{ Params: { sol: string } }>('/api/solicitations/:sol', async (req, reply) => {
  const sol = getSolicitation(db, req.params.sol);
  if (!sol) return reply.code(404).send({ error: 'Solicitation not found' });
  return sol;
});

app.post('/api/ingest', async (_req, reply) => {
  const alreadyRunning = ingester.status.running;
  void ingester.run();
  return reply.code(202).send({ started: !alreadyRunning, status: ingester.status });
});

await app.listen({ port: PORT, host: '0.0.0.0' });

void ingester.run();
if (INGEST_INTERVAL_MIN > 0) {
  setInterval(() => void ingester.run(), INGEST_INTERVAL_MIN * 60_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
