import { sentryVitePlugin } from "@sentry/vite-plugin"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { promisify } from "node:util"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const execFileAsync = promisify(execFile)

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

function openFictionProjectPlugin() {
  return {
    name: "openfiction-project-api",
    configureServer(server: any) {
      server.middlewares.use("/openfiction/project", async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method !== "POST") {
          next()
          return
        }

        try {
          const input = await readJson(req)
          const seed = projectSeedFromInput(input)
          const title = seed.titleWorking
          if (!title) {
            sendJson(res, 400, { error: "请输入项目名" })
            return
          }
          if (!seed.premise) {
            sendJson(res, 400, { error: "请输入故事前提" })
            return
          }

          const workspaceRoot = path.resolve(
            process.env.OPENFICTION_WORKSPACE_ROOT ?? path.resolve(process.cwd(), "../../../.."),
          )
          const novelsRoot = path.resolve(process.env.OPENFICTION_NOVELS_DIR ?? path.join(workspaceRoot, "novels"))
          const directoryName = safeDirectoryName(title)
          const projectRoot = path.resolve(novelsRoot, directoryName)
          const relative = path.relative(novelsRoot, projectRoot)
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            sendJson(res, 400, { error: "项目路径无效" })
            return
          }
          if (await exists(path.join(projectRoot, "project.yaml"))) {
            sendJson(res, 409, { error: `小说项目已存在：${directoryName}` })
            return
          }

          await fs.mkdir(novelsRoot, { recursive: true })
          const bunPath = process.env.OPENFICTION_BUN_PATH || process.execPath || "bun"
          await execFileAsync(
            bunPath,
            ["packages/opencode-adapter/src/cli.ts", "init", projectRoot, "--title", title],
            {
              cwd: workspaceRoot,
              env: process.env,
              windowsHide: true,
            },
          )
          const projectId = directoryName
          await writeOpenFictionProjectAssets({
            projectId,
            projectRoot,
            relativeRoot: path.relative(workspaceRoot, projectRoot).replaceAll("\\", "/"),
            seed,
          })

          sendJson(res, 200, {
            name: title,
            directory: projectRoot,
            created: true,
            projectId,
          })
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      })
    },
  }
}

type ProjectCreateSeed = {
  titleWorking: string
  premise: string
  language: string
  targetTotalWords: number
  targetTotalWordsPolicy?: "unlimited"
  targetTotalWordsLabel?: string
  targetAudience: string
  genreMix: string[]
  openingPolicy: string
  worldview: string
  history: string
  currentEra: string
  protagonistSeed: string
  protagonistName: string
  protagonistDilemma: string
  protagonistGoal: string
  characterSeeds: string[]
  styleNarrationPov: string
  toneTags: string[]
  proseDo: string[]
  proseAvoid: string[]
  pacing: string
  dialogueStyle: string
  referenceWorks: string[]
  ruleSeeds: string[]
  loreSeeds: string[]
  foreshadowSeeds: string[]
  startingAction: string
  startingLocation: string
  initialPressure: string
  forbiddenOpenings: string[]
  firstSegmentStopHint: string
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8")
      if (!text.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

async function exists(target: string) {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

function safeDirectoryName(input: string) {
  const cleaned = input
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
  return cleaned || "untitled-novel"
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function textField(input: Record<string, unknown>, key: string, fallback = "") {
  const value = input[key]
  return typeof value === "string" ? value.trim() : fallback
}

function listField(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value !== "string") return []
  return value
    .split(/\r?\n|,|，|;|；/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function longListField(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value !== "string") return []
  return value
    .split(/\r?\n\r?\n|---+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function targetWordsFromInput(input: Record<string, unknown>) {
  const raw = textField(input, "targetTotalWords", "500000")
  if (raw === "不限" || raw.toLowerCase() === "unlimited") {
    return {
      targetTotalWords: 2_147_483_647,
      targetTotalWordsPolicy: "unlimited" as const,
      targetTotalWordsLabel: "不限",
    }
  }
  const parsed = Number.parseInt(raw.replace(/[^\d]/g, ""), 10)
  return {
    targetTotalWords: Number.isFinite(parsed) && parsed > 0 ? parsed : 500000,
    targetTotalWordsPolicy: undefined,
    targetTotalWordsLabel: undefined,
  }
}

function projectSeedFromInput(value: Record<string, unknown>): ProjectCreateSeed {
  const input = asRecord(value)
  const target = targetWordsFromInput(input)
  const titleWorking = textField(input, "titleWorking", textField(input, "name"))
  const protagonistSeed = textField(input, "protagonistSeed")
  return {
    titleWorking,
    premise: textField(input, "premise"),
    language: textField(input, "language", "zh-CN"),
    ...target,
    targetAudience: textField(input, "targetAudience"),
    genreMix: listField(input, "genreMix"),
    openingPolicy: textField(input, "openingPolicy"),
    worldview: textField(input, "worldview"),
    history: textField(input, "history"),
    currentEra: textField(input, "currentEra"),
    protagonistSeed,
    protagonistName: textField(input, "protagonistName", protagonistSeed.split(/[，,]/)[0]?.trim() || "protagonist"),
    protagonistDilemma: textField(input, "protagonistDilemma"),
    protagonistGoal: textField(input, "protagonistGoal", textField(input, "protagonistDilemma")),
    characterSeeds: longListField(input, "characterSeeds"),
    styleNarrationPov: textField(input, "styleNarrationPov"),
    toneTags: listField(input, "toneTags"),
    proseDo: listField(input, "proseDo"),
    proseAvoid: listField(input, "proseAvoid"),
    pacing: textField(input, "pacing"),
    dialogueStyle: textField(input, "dialogueStyle"),
    referenceWorks: listField(input, "referenceWorks"),
    ruleSeeds: longListField(input, "ruleSeeds"),
    loreSeeds: longListField(input, "loreSeeds"),
    foreshadowSeeds: longListField(input, "foreshadowSeeds"),
    startingAction: textField(input, "startingAction"),
    startingLocation: textField(input, "startingLocation"),
    initialPressure: textField(input, "initialPressure"),
    forbiddenOpenings: listField(input, "forbiddenOpenings"),
    firstSegmentStopHint: textField(input, "firstSegmentStopHint"),
  }
}

async function writeJson(target: string, value: unknown) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(value, null, 2) + "\n", "utf8")
}

async function writeText(target: string, value: string) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, value, "utf8")
}

function jsonl(values: unknown[]) {
  return values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")
}

function source(field: string) {
  return { type: "project_creation", field, refId: field }
}

function priorityScore(priority: "critical" | "high" | "medium" | "low") {
  return { critical: 100, high: 80, medium: 50, low: 20 }[priority]
}

function ruleEntries(seed: ProjectCreateSeed) {
  const defaults = [
    "不要用大段设定说明、会议、报到或作者解释替代现场动作。",
    "稳定事实进入 bible、assets、ledger 或 NOVEL.md；正文不得临时推翻已确认设定。",
    "未揭露信息不得让角色提前知道。",
  ]
  return [...defaults, ...seed.ruleSeeds].map((text, index) => ({
    id: `rule-${index + 1}`,
    text,
    normalizedText: text.toLowerCase(),
    hardness: index < 3 ? "hard" : "soft",
    visibility: "writer_visible",
    tags: index < 3 ? ["default"] : ["seed"],
    priority: index < 3 ? "high" : "medium",
    priorityScore: priorityScore(index < 3 ? "high" : "medium"),
    appliesTo: [],
    source: source(index < 3 ? "defaultRules" : "ruleSeeds"),
  }))
}

function loreEntries(seed: ProjectCreateSeed) {
  const entries = [
    ...seed.worldview.split(/\r?\n\r?\n/).filter(Boolean).map((body, index) => ({
      id: `world-${index + 1}`,
      title: `World ${index + 1}`,
      body,
      content: body,
      kind: "world",
      type: "world_rule",
      hardness: "soft",
      visibility: "writer_visible",
      keys: [seed.titleWorking, ...seed.genreMix],
      tags: ["world"],
      priority: index === 0 ? "high" : "medium",
      priorityScore: priorityScore(index === 0 ? "high" : "medium"),
      source: source("worldview"),
    })),
    ...seed.history.split(/\r?\n\r?\n/).filter(Boolean).map((body, index) => ({
      id: `history-${index + 1}`,
      title: `History ${index + 1}`,
      body,
      content: body,
      kind: "history",
      type: "history",
      hardness: "soft",
      visibility: "planner_only",
      keys: [seed.titleWorking, "history"],
      tags: ["history"],
      priority: index === 0 ? "high" : "medium",
      priorityScore: priorityScore(index === 0 ? "high" : "medium"),
      source: source("history"),
    })),
    ...(seed.currentEra
      ? [{
          id: "current-era",
          title: "Current Era",
          body: seed.currentEra,
          content: seed.currentEra,
          kind: "current_era",
          type: "era_state",
          hardness: "soft",
          visibility: "writer_visible",
          keys: [seed.currentEra],
          tags: ["current_era"],
          priority: "high",
          priorityScore: 80,
          source: source("currentEra"),
        }]
      : []),
    ...seed.loreSeeds.map((body, index) => ({
      id: `lore-${index + 1}`,
      title: `Lore ${index + 1}`,
      body,
      content: body,
      kind: "other",
      type: "world_rule",
      hardness: "soft",
      visibility: "writer_visible",
      keys: [seed.titleWorking],
      tags: ["seed"],
      priority: "medium",
      priorityScore: 50,
      source: source("loreSeeds"),
    })),
  ]
  return entries
}

function characterCards(seed: ProjectCreateSeed) {
  return [
    {
      id: "protagonist",
      name: seed.protagonistName || "protagonist",
      role: "protagonist",
      seed: seed.protagonistSeed,
      initialDilemma: seed.protagonistDilemma,
      currentGoal: seed.protagonistGoal || seed.protagonistDilemma,
      knownFacts: [seed.premise].filter(Boolean),
      mustNotKnow: [],
      advantages: [],
      limitations: [],
      voiceRules: seed.proseDo,
      behaviorRules: [],
      relationshipNotes: [],
      tags: ["protagonist"],
      visibility: "writer_visible",
      priority: "high",
      priorityScore: 80,
      source: source("protagonistSeed"),
    },
    ...seed.characterSeeds.map((text, index) => ({
      id: `character-${index + 1}`,
      name: text.split(/[，,\n]/)[0]?.trim() || `character-${index + 1}`,
      role: "supporting",
      seed: text,
      tags: ["supporting"],
      visibility: "writer_visible",
      priority: "medium",
      priorityScore: 50,
      source: source("characterSeeds"),
    })),
  ]
}

function foreshadowEntries(seed: ProjectCreateSeed) {
  return seed.foreshadowSeeds.map((surfaceHint, index) => ({
    id: `foreshadow-${index + 1}`,
    title: `Foreshadow ${index + 1}`,
    surfaceHint,
    authorTruth: "",
    firstAppearanceWindow: "",
    revealWindow: "",
    payoff: "",
    payoffWindow: "",
    writerVisibleSurfaceHint: true,
    forbiddenBefore: "",
    hardness: "optional",
    visibility: "author_only_boundary",
    keys: [],
    tags: ["foreshadowing"],
    priority: "medium",
    priorityScore: 50,
    source: source("foreshadowSeeds"),
  }))
}

function novelMarkdown(seed: ProjectCreateSeed, projectId: string) {
  return [
    "# Novel Project Instructions",
    "",
    `Project: ${seed.titleWorking}`,
    `Project ID: ${projectId}`,
    "",
    "## Operating Rules",
    "- Treat this directory as one complete novel project.",
    "- Use project assets, bible, ledgers, rules, notes, drafts, final chapters, and trace files as the source of truth.",
    "- Continue from the current visible pressure. Do not restart, recap, or explain the premise when scene action can carry it.",
    "- Do not use web, browser, search, webfetch, or websearch tools.",
    "",
    "## Project Brief",
    "",
    "### Premise",
    seed.premise,
    "",
    "### Genre",
    seed.genreMix.map((item) => `- ${item}`).join("\n") || "- 待补充",
    "",
    "### Opening Policy",
    seed.openingPolicy || seed.startingAction || "- 待补充",
    "",
    "### Protagonist",
    seed.protagonistSeed || seed.protagonistName || "待补充",
    "",
    "### Protagonist Dilemma",
    seed.protagonistDilemma || "待补充",
    "",
  ].join("\n")
}

async function writeOpenFictionProjectAssets(input: {
  projectId: string
  projectRoot: string
  relativeRoot: string
  seed: ProjectCreateSeed
}) {
  const { projectId, projectRoot, relativeRoot, seed } = input
  const rules = ruleEntries(seed)
  const lore = loreEntries(seed)
  const characters = characterCards(seed)
  const foreshadows = foreshadowEntries(seed)
  const openingPolicy = {
    mode: "cold_start",
    firstMove: seed.openingPolicy || seed.startingAction,
    startingAction: seed.startingAction || seed.openingPolicy,
    openingImage: "",
    immediatePressure: seed.initialPressure || seed.protagonistDilemma || seed.premise,
    location: seed.startingLocation,
    mustInclude: [],
    mustAvoid: [
      ...seed.forbiddenOpenings,
      "不要用世界观旁白、会议、报到或大段设定说明替代开场动作。",
    ],
    forbiddenOpenings: seed.forbiddenOpenings,
    firstSegmentStopHint: seed.firstSegmentStopHint,
    source: source("openingPolicy"),
  }
  const assets = {
    projectCapsule: {
      projectId,
      title: seed.titleWorking,
      language: seed.language,
      targetWordCount: seed.targetTotalWords,
      targetWordCountPolicy: seed.targetTotalWordsPolicy,
      targetWordCountLabel: seed.targetTotalWordsLabel,
      premise: seed.premise,
      targetReaders: seed.targetAudience,
      genreTags: seed.genreMix,
      protagonistArc: seed.protagonistDilemma,
    },
    ruleCard: {
      title: seed.titleWorking,
      entries: rules,
    },
    styleProfile: {
      narrationPov: seed.styleNarrationPov,
      proseStyle: seed.proseDo,
      pacing: seed.pacing,
      toneKeywords: seed.toneTags,
      dialogueStyle: seed.dialogueStyle,
      avoidStyle: seed.proseAvoid,
      referenceWorks: seed.referenceWorks,
    },
    openingPolicy,
    lorebook: lore,
    characterCards: characters,
    foreshadowing: foreshadows,
    generationProfile: {
      targetWordCount: seed.targetTotalWords,
      targetWordCountPolicy: seed.targetTotalWordsPolicy,
      targetWordCountLabel: seed.targetTotalWordsLabel,
      language: seed.language,
      targetReaders: seed.targetAudience,
      genreTags: seed.genreMix,
      defaultMode: "chapter_scene_write",
      writerPromptBudget: "normal",
      debugJsonReferenceDefault: false,
      softPlanDriftPolicy: "accept_if_no_hard_error",
      outputContractInjection: "backend_only",
      promptVersion: "writer-v8",
      outputMode: "autopilot",
      promptBudget: {
        maxLoreEntries: 8,
        maxForeshadowHints: 4,
      },
    },
    visibilityMap: {
      writer_visible: [
        ...rules.filter((item) => item.visibility === "writer_visible").map((item) => item.id),
        ...lore.filter((item) => item.visibility === "writer_visible").map((item) => item.id),
        ...characters.map((item) => item.id),
      ],
      planner_only: lore.filter((item) => item.visibility === "planner_only").map((item) => item.id),
      reviewer_only: [],
      author_only_boundary: foreshadows.map((item) => item.id),
      trace_only: [],
    },
  }

  await Promise.all([
    writeJson(path.join(projectRoot, "project.json"), {
      id: projectId,
      title: seed.titleWorking,
      rootPath: relativeRoot,
      genreTags: seed.genreMix,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        language: seed.language,
        targetAudience: seed.targetAudience,
        targetTotalWords: seed.targetTotalWords,
        targetTotalWordsPolicy: seed.targetTotalWordsPolicy,
        targetTotalWordsLabel: seed.targetTotalWordsLabel,
        openingPolicy: seed.openingPolicy,
        creationMode: "openfiction_fork_project_create",
        creationSeed: seed,
      },
    }),
    writeJson(path.join(projectRoot, "assets/project-capsule.json"), assets.projectCapsule),
    writeJson(path.join(projectRoot, "assets/rule-card.json"), assets.ruleCard),
    writeJson(path.join(projectRoot, "assets/style-profile.json"), assets.styleProfile),
    writeJson(path.join(projectRoot, "assets/opening-policy.json"), openingPolicy),
    writeJson(path.join(projectRoot, "assets/generation-profile.json"), assets.generationProfile),
    writeJson(path.join(projectRoot, "assets/visibility-map.json"), assets.visibilityMap),
    writeJson(path.join(projectRoot, "assets/project-assets.json"), assets),
    writeText(path.join(projectRoot, "lorebook/entries.jsonl"), jsonl(lore)),
    writeText(path.join(projectRoot, "foreshadowing/entries.jsonl"), jsonl(foreshadows)),
    writeText(path.join(projectRoot, "characters/cards.jsonl"), jsonl(characters)),
    writeJson(path.join(projectRoot, "characters/protagonist.json"), characters[0]),
    writeJson(path.join(projectRoot, "state/autopilot-state.json"), {
      storyState: {
        currentChapterNo: 1,
        currentArc: "project_create",
        currentTime: seed.currentEra,
        currentLocation: seed.startingLocation,
        mainConflict: seed.protagonistDilemma || seed.premise,
        currentPressure: seed.initialPressure || seed.protagonistDilemma || seed.premise,
        nextPressure: seed.protagonistDilemma || seed.premise,
        openQuestions: [],
        continuityFacts: [seed.premise].filter(Boolean),
      },
      autopilotRuntime: {
        mode: "paused",
        lastDecision: "project_created_from_seed",
        lastArchivedChapter: 0,
      },
    }),
    writeJson(path.join(projectRoot, "state/context-index.json"), {
      characterIndex: characters.map((character) => ({
        characterId: character.id,
        name: character.name,
        role: character.role,
        sourceRef: `characters/cards.jsonl#${character.id}`,
      })),
      loreIndex: lore.map((entry) => ({
        loreId: entry.id,
        title: entry.title,
        visibility: entry.visibility,
        sourceRef: `lorebook/entries.jsonl#${entry.id}`,
      })),
      foreshadowIndex: foreshadows.map((entry) => ({
        foreshadowId: entry.id,
        status: "open",
        evidenceText: entry.surfaceHint,
        sourceRef: `foreshadowing/entries.jsonl#${entry.id}`,
      })),
      updatedAt: new Date().toISOString(),
    }),
    writeText(path.join(projectRoot, "NOVEL.md"), novelMarkdown(seed, projectId)),
    writeText(path.join(projectRoot, "rules/style.md"), [
      "# Style Rules",
      "",
      ...seed.proseDo.map((item) => `- ${item}`),
      ...seed.toneTags.map((item) => `- ${item}`),
      seed.dialogueStyle ? `- Dialogue: ${seed.dialogueStyle}` : "",
      "",
      "## Avoid",
      ...seed.proseAvoid.map((item) => `- ${item}`),
      "",
    ].filter(Boolean).join("\n")),
    writeText(path.join(projectRoot, "rules/continuity.md"), [
      "# Continuity Rules",
      "",
      "## Premise",
      seed.premise,
      "",
      "## Worldview",
      seed.worldview,
      "",
      "## Current Era",
      seed.currentEra,
      "",
      "## Opening Boundary",
      seed.openingPolicy,
      "",
    ].join("\n")),
    writeText(path.join(projectRoot, "notes/continuity.md"), [
      "# Working Continuity Notes",
      "",
      "- This scratchpad is not loaded by default.",
      `- Premise: ${seed.premise}`,
      `- Protagonist: ${seed.protagonistName}`,
      "",
    ].join("\n")),
    writeText(path.join(projectRoot, "bible/world.md"), `# World Bible\n\n${seed.worldview || seed.premise}\n`),
    writeText(path.join(projectRoot, "bible/rules.md"), `# Rule Cards\n\n${rules.map((item) => `- ${item.text}`).join("\n")}\n`),
    writeText(path.join(projectRoot, "bible/style.md"), `# Style\n\n${seed.proseDo.map((item) => `- ${item}`).join("\n") || "待补充。"}\n`),
    writeText(path.join(projectRoot, "bible/genre.md"), `# Genre\n\n${seed.genreMix.map((item) => `- ${item}`).join("\n") || "待补充。"}\n`),
    writeJson(path.join(projectRoot, "outline/book-plan.json"), {
      title: seed.titleWorking,
      promise: seed.premise,
      targetReaders: seed.targetAudience,
      genreTags: seed.genreMix,
      volumes: [],
    }),
  ])
}

export default defineConfig({
  plugins: [openFictionProjectPlugin(), desktopPlugin, sentry] as any,
  server: {
    host: "127.0.0.1",
    allowedHosts: true,
    port: 3217,
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
})
