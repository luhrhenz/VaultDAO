import assert from "node:assert/strict";
import test from "node:test";

import type { Job } from "./job.manager.js";
import { JobManager } from "./job.manager.js";

function createJob(name: string, startImpl: () => Promise<void> | void): Job {
  return {
    name,
    start: startImpl,
    stop: () => undefined,
    isRunning: () => false,
  };
}

test("JobManager.startAll includes failed job names and errors", async () => {
  const manager = new JobManager();
  const started: string[] = [];

  manager.registerJob(
    createJob("event-polling", () => {
      throw new Error("RPC unavailable");
    })
  );

  manager.registerJob(
    createJob("recurring-indexer", () => {
      throw new Error("auth denied");
    })
  );

  manager.registerJob(
    createJob("metrics", () => {
      started.push("metrics");
    })
  );

  await assert.rejects(
    manager.startAll(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /2 jobs failed to start:/);
      assert.match(error.message, /- event-polling: RPC unavailable/);
      assert.match(error.message, /- recurring-indexer: auth denied/);
      return true;
    }
  );

  assert.deepEqual(started, ["metrics"]);
});
