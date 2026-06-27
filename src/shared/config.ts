import 'dotenv/config';
import { z } from 'zod';

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => v === undefined || v === '' ? undefined : v.toLowerCase() === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().default(8080),
  WS_PORT: z.coerce.number().int().default(8081),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),

  STATE_BACKEND: z.enum(['memory', 'dynamo']).default('memory'),
  STATE_TABLE: z.string().default('extraction_jobs'),
  AWS_REGION: z.string().default('eu-west-1'),

  DOCS_BUCKET: z.string().default('finidian-rpa-docs'),
  DOCS_KMS_KEY_ID: z.string().optional(),

  PROXY_SERVER: z.string().optional(),
  PROXY_USERNAME: z.string().optional(),
  PROXY_PASSWORD: z.string().optional(),
  PROXY_USERNAME_TEMPLATE: z.string().default('{user}-country-{country}-session-{session}'),
  PROXY_COUNTRY: z.string().default('es'),

  HEADLESS: boolFromEnv.default('true'),
  BROWSER_USER_AGENT: z
    .string()
    .default(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    ),
  CLAVE_GATE_TIMEOUT_MS: z.coerce.number().int().default(95_000),
  JOB_MAX_LIFETIME_MS: z.coerce.number().int().default(480_000),

  HUMAN_GATE_MODE: z.enum(['poll', 'stepfunctions']).default('poll'),

  // El worker empuja eventos al control-plane para reenvío inmediato por WS.
  CONTROL_PLANE_URL: z.string().default('http://localhost:8080'),
  INTERNAL_API_TOKEN: z.string().default('dev-internal-token'),

  // Parámetros del job inyectados por ECS RunTask (overrides) en el worker.
  JOB_PARAMS: z.string().optional(),

  // Demo offline: usa un scraper falso (sin navegar a las sedes) y omite S3.
  // Permite ejercitar el flujo completo (reto Cl@ve → confirmación → PDF) en local.
  DEV_FAKE_SCRAPE: boolFromEnv.default('false'),
  DEV_SKIP_S3: boolFromEnv.default('false'),

  // Lanzamiento del worker:
  //  - "inline": ejecuta el job en el mismo proceso del API (demo offline, comparte store en memoria)
  //  - "local":  spawn de un proceso tsx por job (dev multiproceso)
  //  - "ecs":    RunTask Fargate (producción)
  WORKER_LAUNCH_MODE: z.enum(['inline', 'local', 'ecs']).default('local'),
  ECS_CLUSTER: z.string().optional(),
  ECS_TASK_DEFINITION: z.string().optional(),
  ECS_CONTAINER_NAME: z.string().default('worker'),
  ECS_SUBNETS: z.string().optional(), // CSV de subnet ids privados
  ECS_SECURITY_GROUPS: z.string().optional(), // CSV de security group ids
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Configuración de entorno inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
