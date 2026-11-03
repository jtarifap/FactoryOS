/**
 * Model catalog helpers.
 *
 * OpenCode model ids are `<provider>/<model>` but aggregators such as OpenRouter
 * expose one more segment (`openrouter/openai/gpt-4.1`) and use extra characters
 * (`~` for rolling aliases, `:` for variant suffixes). Every id here keeps the
 * full path so those models can be listed, selected and stored in the agents.
 */

export type ModelMeta = {
  id: string;
  name: string;
  providerID: string;
  status?: string;
  capabilities?: { reasoning: boolean; input: { text: boolean; image: boolean; audio: boolean; pdf: boolean; video: boolean } };
  limit?: { context: number; output: number };
  cost?: { input: number; output: number };
};

const ID_SEGMENT = "[A-Za-z0-9._:~-]+";
const MODEL_ID_PATTERN = new RegExp(`^${ID_SEGMENT}(?:/${ID_SEGMENT})+$`);
const MAX_MODEL_ID_LENGTH = 160;

/** Accepts `provider/model` and deeper paths such as `openrouter/openai/gpt-4.1`. */
export function isModelId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.trim().length <= MAX_MODEL_ID_LENGTH
    && MODEL_ID_PATTERN.test(value.trim());
}

const isModelIdLine = (line: string): boolean => isModelId(line);

const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const parseCapabilities = (data: any) => data?.capabilities ? {
  reasoning: !!data.capabilities.reasoning,
  input: {
    text: !!data.capabilities.input?.text,
    image: !!data.capabilities.input?.image,
    audio: !!data.capabilities.input?.audio,
    pdf: !!data.capabilities.input?.pdf,
    video: !!data.capabilities.input?.video
  }
} : undefined;

/** Extracts the first complete JSON object, ignoring anything that follows it. */
const firstJsonObject = (text: string): string => {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
      if (depth < 0) return "";
    }
  }
  return "";
};

/** Reads a JSON object out of a verbose block, tolerating trailing noise. */
const parseJsonObject = (lines: string[]): any | null => {
  const text = lines.join("\n").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const candidate = firstJsonObject(text);
    if (!candidate) return null;
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
};

const toModelMeta = (id: string, data: any): ModelMeta => ({
  id,
  name: typeof data.name === "string" ? data.name : id,
  providerID: typeof data.providerID === "string" ? data.providerID : id.split("/")[0],
  status: typeof data.status === "string" ? data.status : undefined,
  capabilities: parseCapabilities(data),
  limit: data.limit ? { context: numberValue(data.limit.context), output: numberValue(data.limit.output) } : undefined,
  cost: data.cost ? { input: numberValue(data.cost.input), output: numberValue(data.cost.output) } : undefined
});

/**
 * Parses the output of `opencode models --verbose`, where every model is a line
 * with its id followed by its JSON definition. Each block is parsed on its own so
 * an unknown id never invalidates the model listed before it.
 */
export function parseModelBlocks(output: string): ModelMeta[] {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/);
  const blocks: { id: string; json: string[] }[] = [];
  let currentId = "";
  let currentJson: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (isModelIdLine(trimmed)) {
      if (currentId) blocks.push({ id: currentId, json: currentJson });
      currentId = trimmed;
      currentJson = [];
    } else if (currentId) {
      currentJson.push(line);
    }
  }
  if (currentId) blocks.push({ id: currentId, json: currentJson });

  const models: ModelMeta[] = [];
  for (const block of blocks) {
    const data = parseJsonObject(block.json);
    if (!data) continue;
    models.push(toModelMeta(block.id, data));
  }
  return models;
}

/** Adds the provider prefix to a catalog model key when it is missing. */
export const qualifyModelId = (providerId: string, modelId: string): string => {
  const id = modelId.trim();
  if (!id) return "";
  if (!providerId) return id.includes("/") ? id : "";
  return id.startsWith(`${providerId}/`) ? id : `${providerId}/${id}`;
};

/** Reads the models.dev catalog cached by OpenCode. */
export function modelsFromCatalog(cache: unknown): ModelMeta[] {
  const models: ModelMeta[] = [];
  if (!cache || typeof cache !== "object") return models;

  for (const provider of Object.values(cache as Record<string, any>)) {
    if (!provider || typeof provider !== "object") continue;
    const providerId = typeof provider.id === "string" ? provider.id : "";
    const catalogModels = provider.models;
    if (!catalogModels || typeof catalogModels !== "object") continue;

    for (const [key, info] of Object.entries(catalogModels)) {
      const rawId = typeof (info as any)?.id === "string"
        ? (info as any).id
        : (typeof (info as any)?.canonical_model_id === "string" ? (info as any).canonical_model_id : key);
      const id = qualifyModelId(providerId, rawId);
      if (!isModelId(id)) continue;
      const status = typeof (info as any)?.status === "string" ? (info as any).status : undefined;
      // OpenCode hides deprecated models, so the catalog must not offer them either.
      if (status === "deprecated") continue;
      models.push({
        id,
        name: typeof (info as any)?.name === "string" ? (info as any).name : id,
        providerID: typeof (info as any)?.providerID === "string" ? (info as any).providerID : (providerId || id.split("/")[0]),
        status,
        capabilities: parseCapabilities(info),
        limit: (info as any)?.limit ? {
          context: numberValue((info as any).limit.context),
          output: numberValue((info as any).limit.output)
        } : undefined,
        cost: (info as any)?.cost ? {
          input: numberValue((info as any).cost.input),
          output: numberValue((info as any).cost.output)
        } : undefined
      });
    }
  }
  return models;
}

/** Adds the catalog models that the CLI did not list, keeping the listed ones. */
export function mergeModelLists(listed: ModelMeta[], extra: ModelMeta[]): ModelMeta[] {
  const known = new Set(listed.map(model => model.id));
  const merged = [...listed];
  for (const model of extra) {
    if (known.has(model.id)) continue;
    known.add(model.id);
    merged.push(model);
  }
  return merged;
}
