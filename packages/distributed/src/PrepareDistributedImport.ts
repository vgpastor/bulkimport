import type { DataSource, StateStore, DistributedStateStore, ProcessedRecord, Batch } from '@batchactions/core';
import type { EventBus } from '@batchactions/core';
import { BatchSplitter, createPendingRecord, createBatch, isDistributedStateStore } from '@batchactions/core';
import type { SchemaDefinition, SourceParser } from '@batchactions/import';
import { SchemaValidator } from '@batchactions/import';

/** Result of the prepare phase for distributed processing. */
export interface PrepareResult {
  /** Unique job identifier. Use this to dispatch workers. */
  readonly jobId: string;
  /** Total number of records found in the source. */
  readonly totalRecords: number;
  /** Total number of batches created. */
  readonly totalBatches: number;
}

/**
 * Phase 1 of distributed processing: stream the source, materialize records
 * in the StateStore, and register batch boundaries.
 *
 * After this phase, multiple workers can call `ProcessDistributedBatch`
 * to claim and process individual batches in parallel.
 */
export class PrepareDistributedImport {
  private readonly stateStore: DistributedStateStore;
  private readonly eventBus: EventBus;
  private readonly validator: SchemaValidator;
  private readonly batchSize: number;

  constructor(
    private readonly schema: SchemaDefinition,
    stateStore: StateStore,
    eventBus: EventBus,
    batchSize: number,
  ) {
    if (!isDistributedStateStore(stateStore)) {
      throw new Error(
        'Distributed processing requires a DistributedStateStore implementation ' +
          '(e.g. SequelizeStateStore). The InMemoryStateStore does not support distributed batch claiming.',
      );
    }
    this.stateStore = stateStore;
    this.eventBus = eventBus;
    this.validator = new SchemaValidator(schema);
    this.batchSize = batchSize;
  }

  async execute(source: DataSource, parser: SourceParser): Promise<PrepareResult> {
    const jobId = crypto.randomUUID();
    const splitter = new BatchSplitter(this.batchSize);
    const batches: Batch[] = [];
    let totalRecords = 0;

    for await (const { records: rawRecords, batchIndex } of splitter.split(this.streamRecords(source, parser))) {
      const batchId = crypto.randomUUID();
      const recordStartIndex = rawRecords[0]?.index ?? 0;
      const recordEndIndex = rawRecords[rawRecords.length - 1]?.index ?? 0;

      const batch: Batch = {
        ...createBatch(batchId, batchIndex, []),
        recordStartIndex,
        recordEndIndex,
      };
      batches.push(batch);

      await this.stateStore.saveBatchRecords(jobId, batchId, rawRecords);
      totalRecords += rawRecords.length;
    }

    await this.stateStore.saveJobState({
      id: jobId,
      config: {
        schema: this.schema as unknown as Record<string, unknown>,
        batchSize: this.batchSize,
        continueOnError: true,
      },
      status: 'PROCESSING',
      batches,
      totalRecords,
      startedAt: Date.now(),
      distributed: true,
    });

    this.eventBus.emit({
      type: 'distributed:prepared',
      jobId,
      totalRecords,
      totalBatches: batches.length,
      timestamp: Date.now(),
    });

    return { jobId, totalRecords, totalBatches: batches.length };
  }

  private async *streamRecords(source: DataSource, parser: SourceParser): AsyncIterable<ProcessedRecord> {
    let recordIndex = 0;

    for await (const chunk of source.read()) {
      for await (const raw of parser.parse(chunk)) {
        if (this.validator.skipEmptyRows && this.validator.isEmptyRow(raw)) {
          continue;
        }
        yield createPendingRecord(recordIndex, raw);
        recordIndex++;
      }
    }
  }
}
