import { base64Encode } from "@opencode-ai/core/util/encode"

export type ApprovalMode = "ask" | "review" | "full"

export function acceptKey(sessionID: string, directory?: string) {
  if (!directory) return sessionID
  return `${base64Encode(directory)}/${sessionID}`
}

export function directoryAcceptKey(directory: string) {
  return `${base64Encode(directory)}/*`
}

function scopedValue<T>(values: Record<string, T>, sessionID: string, directory?: string) {
  const key = acceptKey(sessionID, directory)
  const directoryKey = directory ? directoryAcceptKey(directory) : undefined
  return values[key] ?? values[sessionID] ?? (directoryKey ? values[directoryKey] : undefined)
}

export function isDirectoryAutoAccepting(autoAccept: Record<string, boolean>, directory: string) {
  const key = directoryAcceptKey(directory)
  return autoAccept[key] ?? false
}

function sessionLineage(session: { id: string; parentID?: string }[], sessionID: string) {
  const parent = session.reduce((acc, item) => {
    if (item.parentID) acc.set(item.id, item.parentID)
    return acc
  }, new Map<string, string>())
  const seen = new Set([sessionID])
  const ids = [sessionID]

  for (const id of ids) {
    const parentID = parent.get(id)
    if (!parentID || seen.has(parentID)) continue
    seen.add(parentID)
    ids.push(parentID)
  }

  return ids
}

export function autoRespondsPermission(
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  permission: { sessionID: string },
  directory?: string,
) {
  const value = sessionLineage(session, permission.sessionID)
    .map((id) => scopedValue(autoAccept, id, directory))
    .find((item): item is boolean => item !== undefined)
  return value ?? false
}

export function approvalModeFor(
  modes: Record<string, ApprovalMode>,
  autoAccept: Record<string, boolean>,
  session: { id: string; parentID?: string }[],
  sessionID: string,
  directory?: string,
): ApprovalMode {
  for (const id of sessionLineage(session, sessionID)) {
    const mode = scopedValue(modes, id, directory)
    if (mode) return mode
    const legacy = scopedValue(autoAccept, id, directory)
    if (legacy !== undefined) return legacy ? "full" : "ask"
  }
  return "review"
}

const REVIEW_SAFE = new Set([
  "read",
  "glob",
  "grep",
  "lsp",
  "skill",
  "todowrite",
  "webfetch",
  "websearch",
  "novel-factory_generateOutline",
  "novel-factory_submitOutline",
  "novel-factory_pauseAutopilot",
  "novel-factory_resumeAutopilot",
])

export function autoReviewsPermission(permission: { permission: string }) {
  return REVIEW_SAFE.has(permission.permission)
}
