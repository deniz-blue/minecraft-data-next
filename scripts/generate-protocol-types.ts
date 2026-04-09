import path from "node:path";
import process from "node:process";
import CodeBlockWriter from "code-block-writer";
import { ProtocolGenerator } from "protodef-next";
import { readJson, toPascalCase, writeText } from "./util.js";
import type { DataPaths, ProtocolVersionEntry } from "./types.js";

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
const upstreamDataDir = path.join(rootDir, "vendor", "minecraft-data", "data");
const outputJavaProtoDir = path.join(rootDir, "dist", "protocol", "java");

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

async function generateProtocol(v: number, protocolJson: JsonObject): Promise<void> {
	const outputDir = path.join(outputJavaProtoDir, `${v}`);
	const schemaSlices = flattenStateSchemas(protocolJson);
	const groupedByState = Object.groupBy(schemaSlices, (slice) => slice.stateName);

	const writer = new CodeBlockWriter();

	writer.writeLine(`// ! @generated minecraft-data-next: protocol schema ${v}`);
	writer.write(`export declare namespace Packets `).inlineBlock(() => {
		for (const [stateName, slices] of Object.entries(groupedByState).sort(([a], [b]) => a.localeCompare(b))) {
			const stateNamespace = toPascalCase(stateName);

			writer.write(`export namespace ${stateNamespace} `).inlineBlock(() => {
				const sortedSlices = slices!.sort((a, b) => a.direction.localeCompare(b.direction));

				for (const slice of sortedSlices) {
					const directionNamespace = DIRECTION_NAMESPACE_BY_KEY[slice.direction];
					const schema = {
						types: {
							...protocolJson.types as Record<string, unknown>,
							...slice.types
						}
					};

					const generator = new ProtocolGenerator(schema as never);
					const packetTypeNames = Object.keys(slice.types)
						.filter((name) => name.startsWith("packet_"))
						.sort((a, b) => a.localeCompare(b));

					writer.write(`export namespace ${directionNamespace} `).inlineBlock(() => {
						const packetMapEntries: string[] = [];

						for (const packetTypeName of packetTypeNames) {
							const pascalPacketTypeName = packetTypeNameToPascalCase(packetTypeName);
							const packetKey = packetTypeNameToPacketKey(packetTypeName);

							try {
								const generated = replaceGeneratedTypeName(
									generator.generateTypeDefinition(packetTypeName),
									pascalPacketTypeName
								);
								
								writer.writeLine(generated);
							} catch (error) {
								const safeMessage = error instanceof Error ? error.message : "unknown error";
								// console.log(`Error generating type for packet ${packetTypeName} in state ${stateName} (${slice.direction})`, error);
								writer.writeLine(`// Error: ${safeMessage}`);
								writer.writeLine(`export type ${pascalPacketTypeName} = unknown;`);
							}

							writer.blankLine();
							packetMapEntries.push(`${packetKey}: ${pascalPacketTypeName};`);
						}

						if (packetMapEntries.length === 0) {
							writer.writeLine("export interface PacketMap {}");
						} else {
							writer.write("export interface PacketMap ").inlineBlock(() => {
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

	await writeText(path.join(outputDir, "index.d.ts"), writer.toString());
	await writeText(path.join(outputDir, "index.js"), `export {};`);
}

const main = async (): Promise<void> => {
	const dataPaths = await readJson<DataPaths>(path.join(upstreamDataDir, "dataPaths.json"));
	const protocolVersions = await readJson<ProtocolVersionEntry[]>(path.join(upstreamDataDir, "pc", "common", "protocolVersions.json"));

	for (const { version, minecraftVersion, releaseType } of protocolVersions) {
		const protocolPath = dataPaths.pc?.[minecraftVersion]?.protocol;
		if (!protocolPath) {
			console.warn(`Protocol path not found for Minecraft version ${minecraftVersion} (protocol version ${version}). Skipping.`);
			continue;
		}

		const protocolJson = await readJson<JsonObject>(path.join(upstreamDataDir, protocolPath, "protocol.json"));

		await generateProtocol(version, protocolJson);

		console.log(`Generated protocol types for Minecraft version ${minecraftVersion} (protocol version ${version}).`);
	}
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
