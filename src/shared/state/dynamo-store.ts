import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from '../config.js';
import type { ClaveChallenge, ExtractionStatus, JobState } from '../types.js';
import type { JobStateStore } from './store.js';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.AWS_REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Store DynamoDB. La tabla usa `jobId` como partition key y un atributo `ttl`
 * (epoch segundos) configurado como TTL para autolimpieza.
 */
export class DynamoJobStateStore implements JobStateStore {
  private readonly table = config.STATE_TABLE;

  async create(jobId: string, initial: Partial<JobState>): Promise<JobState> {
    const state: JobState = {
      jobId,
      status: initial.status ?? 'PENDING',
      userConfirmed: false,
      cancelRequested: false,
      updatedAt: Date.now(),
      ttl: Math.floor((Date.now() + 15 * 60 * 1000) / 1000),
      ...initial,
    };
    await client.send(new PutCommand({ TableName: this.table, Item: state }));
    return state;
  }

  async get(jobId: string): Promise<JobState | undefined> {
    const res = await client.send(new GetCommand({ TableName: this.table, Key: { jobId } }));
    return res.Item as JobState | undefined;
  }

  async patch(jobId: string, patch: Partial<JobState>): Promise<JobState> {
    const entries = Object.entries({ ...patch, updatedAt: Date.now() });
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets: string[] = [];
    for (const [k, v] of entries) {
      names[`#${k}`] = k;
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
    const res = await client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { jobId },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return res.Attributes as JobState;
  }

  async setStatus(jobId: string, status: ExtractionStatus): Promise<void> {
    await this.patch(jobId, { status });
  }

  async setChallenge(jobId: string, challenge: ClaveChallenge): Promise<void> {
    await this.patch(jobId, { challenge, status: 'AWAITING_CLAVE' });
  }

  async confirm(jobId: string): Promise<void> {
    await this.patch(jobId, { userConfirmed: true });
  }

  async cancel(jobId: string): Promise<void> {
    await this.patch(jobId, { cancelRequested: true });
  }
}
