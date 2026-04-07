import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import CodeBlockWriter from "code-block-writer";
import { ProtocolGenerator } from "protodef-next";

type JsonObject = Record<string, unknown>;

type SchemaSlice = {
  stateName: string;
  direction: "toClient" | "toServer";
  types: Record<string, unknown>;
};

const DIRECTION_NAMESPACE_BY_KEY: Record<SchemaSlice["direction"], string> = {
  toClient: "Client",
  toServer: "Server"
};

const rootDir = process.cwd();
const dataRoot = path.join(rootDir, "src", "generated", "data", "java");
const protocolOutputRoot = path.join(rootDir, "src", "generated", "protocol", "java");
const versionsFile = path.join(rootDir, "src", "generated", "meta", "selected-versions.json");

function toPascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr: string) => chr.toUpperCase())
    .replace(/^./, (chr) => chr.toUpperCase());
}

function packetTypeNameToPascalCase(packetTypeName: string): string {
  return toPascalCase(packetTypeName.replace(/^packet_/, ""));
}

function packetTypeNameToPacketKey(packetTypeName: string): string {
  return packetTypeName.replace(/^packet_/, "");
}

function sanitizeGeneratedTypeDefinition(source: string): string {
  return source
    .replace(/=\s*\(\);/g, "= Record<string, never>;")
    .replace(/name:\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g, 'name: "$1";');
}

function replaceGeneratedTypeName(source: string, typeName: string): string {
  return source.replace(/^export type\s+[A-Za-z0-9_]+\s+=/, `export type ${typeName} =`);
}

function writeMultiline(writer: CodeBlockWriter, source: string): void {
  const lines = source.trimEnd().split("\n");
  for (const line of lines) {
    writer.writeLine(line);
  }
}

function flattenStateSchemas(protocolJson: JsonObject): SchemaSlice[] {
  const states = Object.entries(protocolJson).filter(([name]) => name !== "types");
  const results: SchemaSlice[] = [];

  for (const [stateName, stateValue] of states) {
    if (!stateValue || typeof stateValue !== "object") {
      continue;
    }

    const typedState = stateValue as JsonObject;
    for (const direction of ["toClient", "toServer"] as const) {
      const scoped = typedState[direction];
      if (!scoped || typeof scoped !== "object") {
        continue;
      }

      const typedScoped = scoped as JsonObject;
      const scopedTypes = typedScoped.types;
      if (!scopedTypes || typeof scopedTypes !== "object") {
        continue;
      }

      results.push({
        stateName,
        direction,
        types: scopedTypes as Record<string, unknown>
      });
    }
  }

  return results;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function writeText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

const versions = await readJson<string[]>(versionsFile);

for (const version of versions) {
  const protocolPath = path.join(dataRoot, version, "protocol.json");
  const protocolJson = await readJson<JsonObject>(protocolPath);

  const baseTypes = (protocolJson.types ?? {}) as Record<string, unknown>;
  const schemaSlices = flattenStateSchemas(protocolJson);
  const versionOutputDir = path.join(protocolOutputRoot, version);
  const groupedByState = new Map<string, SchemaSlice[]>();

  for (const slice of schemaSlices) {
    const stateEntries = groupedByState.get(slice.stateName) ?? [];
    stateEntries.push(slice);
    groupedByState.set(slice.stateName, stateEntries);
  }

  const writer = new CodeBlockWriter({
    useTabs: false,
    indentNumberOfSpaces: 2,
    newLine: "\n"
  });

  writer.writeLine(`// Generated from upstream protocol schema (${version}).`);
  writer.write("export declare namespace Packets ").block(() => {
    const sortedStateNames = [...groupedByState.keys()].sort((a, b) => a.localeCompare(b));

    for (const stateName of sortedStateNames) {
      const stateNamespace = toPascalCase(stateName);

      writer.write(`export namespace ${stateNamespace} `).block(() => {
        const slices = (groupedByState.get(stateName) ?? []).sort((a, b) =>
          a.direction.localeCompare(b.direction)
        );

        for (const slice of slices) {
          const directionNamespace = DIRECTION_NAMESPACE_BY_KEY[slice.direction];
          const schema = {
            types: {
              ...baseTypes,
              ...slice.types
            }
          };

          const generator = new ProtocolGenerator(schema as never);
          const packetTypeNames = Object.keys(slice.types)
            .filter((name) => name.startsWith("packet_"))
            .sort((a, b) => a.localeCompare(b));

          writer.write(`export namespace ${directionNamespace} `).block(() => {
            const packetMapEntries: string[] = [];

            for (const packetTypeName of packetTypeNames) {
              const pascalPacketTypeName = packetTypeNameToPascalCase(packetTypeName);
              const packetKey = packetTypeNameToPacketKey(packetTypeName);

              try {
                const generated = replaceGeneratedTypeName(
                  sanitizeGeneratedTypeDefinition(generator.generateTypeDefinition(packetTypeName)),
                  pascalPacketTypeName
                );
                writeMultiline(writer, generated);
                writer.blankLine();
                packetMapEntries.push(`${packetKey}: ${pascalPacketTypeName};`);
              } catch (error) {
                const safeMessage = error instanceof Error ? error.message : "unknown error";
                writer.writeLine(`export type ${pascalPacketTypeName} = unknown;`);
                writer.writeLine(`// Generation fallback: ${safeMessage}`);
                writer.blankLine();
                packetMapEntries.push(`${packetKey}: ${pascalPacketTypeName};`);
              }
            }

            if (packetMapEntries.length === 0) {
              writer.writeLine("export interface PacketMap {}");
            } else {
              writer.write("export interface PacketMap ").block(() => {
                for (const entry of packetMapEntries) {
                  writer.writeLine(entry);
                }
              });
            }
            writer.blankLine();
          });
        }
      });
    }
  });

  await writeText(path.join(versionOutputDir, "index.ts"), writer.toString());
}
