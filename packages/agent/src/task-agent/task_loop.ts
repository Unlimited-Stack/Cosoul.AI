import { processDraftingTask, processSearchingTask } from "./dispatcher";
import { readTaskDocument, saveTaskMD, appendRawChat, appendRawChatSummary } from "./storage";
import type { TaskDocument, TaskStatus } from "./types";

type RunnableTaskState = "Drafting" | "Revising" | "Searching";

interface StartTaskLoopOptions {
  activeTaskId?: string | null;
  continuous?: boolean;
  idleSleepMs?: number;
}

export interface TaskStepResult {
  taskId: string;
  previousStatus: TaskStatus;
  currentStatus: TaskStatus;
  handled: boolean;
  changed: boolean;
}

/**
 * Active flow task-loop engine.
 * Drives: Drafting → Searching → Waiting_Human transitions.
 * Does not perform I/O directly; delegates to dispatcher and storage.
 */
export async function startTaskLoop(options: StartTaskLoopOptions = {}): Promise<void> {
  let currentTaskId = options.activeTaskId ?? null;
  const continuous = options.continuous ?? false;
  const idleSleepMs = options.idleSleepMs ?? 1000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let progress = false;
    if (currentTaskId) {
      const result = await runTaskStepById(currentTaskId);
      progress = result.changed;
      // Clear current task when it reaches a terminal or non-runnable state
      if (
        !result.handled ||
        result.currentStatus === "Closed" ||
        result.currentStatus === "Cancelled" ||
        result.currentStatus === "Failed" ||
        result.currentStatus === "Timeout"
      ) {
        currentTaskId = null;
      }
    }

    if (!continuous) {
      return;
    }

    if (!progress) {
      await sleep(idleSleepMs);
    }
  }
}

export async function runTaskStepById(taskId: string): Promise<TaskStepResult> {
  const task = await readTaskDocument(taskId);
  const changed = await runTaskStep(task);
  const latest = changed ? await readTaskDocument(taskId) : task;
  const handled = isRunnableStatus(task.frontmatter.status);
  return {
    taskId,
    previousStatus: task.frontmatter.status,
    currentStatus: latest.frontmatter.status,
    handled,
    changed
  };
}

export async function runTaskStep(task: TaskDocument): Promise<boolean> {
  switch (task.frontmatter.status) {
    case "Drafting":
    case "Revising":
      return processDraftingTask(task);
    case "Searching":
      return processSearchingTask(task);
    default:
      return false;
  }
}

/**
 * Persist a newly created task from intake and save the initial transcript.
 */
export async function saveIntakeResult(
  task: TaskDocument,
  transcript: string[],
  timestamp: string
): Promise<void> {
  await saveTaskMD(task);
  const transcriptText = transcript.join("\n\n");
  await appendRawChat(task.frontmatter.task_id, transcriptText, timestamp);
  await appendRawChatSummary(
    `# Intake Summary\n\ntask_id: ${task.frontmatter.task_id}\n\n${task.body.rawDescription}`,
    timestamp
  );
}

function isRunnableStatus(status: TaskStatus): status is RunnableTaskState {
  return status === "Drafting" || status === "Revising" || status === "Searching";
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
