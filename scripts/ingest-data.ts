import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import CodeBlockWriter from "code-block-writer";
import { copy, exists, readJson, toCamelCase, toPascalCase, writeText } from "./util.js";
import type { DataPaths, ProtocolVersionEntry } from "./types.js";

const rootDir = process.cwd();
const upstreamDataDir = path.join(rootDir, "vendor", "minecraft-data", "data");

const outputDataDir = path.join(rootDir, "src", "data");
const outputJavaDataDir = path.join(outputDataDir, "java");
const outputJavaDir = path.join(rootDir, "src", "java");

async function javaData(
	javaVersion: string,
	sourcePaths: Record<string, string>
): Promise<string[]> {
	const outputDir = path.join(outputJavaDataDir, javaVersion);
	await mkdir(outputDir, { recursive: true });

	const domainNames = Object.keys(sourcePaths).sort();
	const domainFiles = new Set<string>();

	for (const domainName of domainNames) {
		const sourceBase = path.join(upstreamDataDir, sourcePaths[domainName]);
		const sourcePath = path.join(sourceBase, `${domainName}.json`);
		const targetPath = path.join(outputDir, `${domainName}.json`);

		if (!(await exists(sourcePath))) {
			continue;
		}

		await copy(sourcePath, targetPath);
		domainFiles.add(`${domainName}.json`);
	}

	return [...domainFiles].sort();
}

async function javaModules(javaVersion: string, domainFiles: string[], protocolVersionNumber: number | undefined): Promise<void> {
	const versionSourceDir = path.join(outputJavaDir, javaVersion);

	const exports: string[] = [];

	for (const fileName of domainFiles) {
		const domain = fileName.slice(0, -5);
		if (domain === "protocol") {
			continue;
		}

		const symbolName = toCamelCase(domain);
		const typeName = toPascalCase(domain);

		const moduleSource = [
			`import data from "../../data/java/${javaVersion}/${fileName}" with { type: "json" };`,
			`export const ${symbolName} = data;`,
			`export type ${typeName} = typeof ${symbolName};`,
			""
		].join("\n");

		await writeText(path.join(versionSourceDir, `${domain}.ts`), moduleSource);
		exports.push(`export * from "./${domain}.js";`);
	}

	if (protocolVersionNumber !== undefined) {
		await writeText(path.join(versionSourceDir, `packets.ts`), [
			"// @ts-ignore",
			`export * from "../../protocol/java/${protocolVersionNumber}/index.js";`
		].join("\n"));
		exports.push(`export * from "./packets.js";`);
	}

	exports.push("");

	await writeText(path.join(versionSourceDir, "index.ts"), `${exports.join("\n")}\n`);
}

async function generateIndex(javaVersions: string[]): Promise<void> {
	const writer = new CodeBlockWriter();

	writer.write(`export const versions = `).inlineBlock(() => {
		writer.write("java: ").inlineBlock(() => {
			for (const version of javaVersions) {
				writer.writeLine(`"${version}": () => import("./${version}/index.js"),`);
			}
		}).write(",");
	}).write(" as const;").newLine();

	writer.writeLine("export type JavaVersionId = keyof typeof versions.java;");

	await writeText(path.join(outputJavaDir, "index.ts"), writer.toString());
}

const main = async (): Promise<void> => {
	const dataPaths = await readJson<DataPaths>(path.join(upstreamDataDir, "dataPaths.json"));
	const protocolVersions = await readJson<ProtocolVersionEntry[]>(path.join(upstreamDataDir, "pc", "common", "protocolVersions.json"));
	const javaVersionIds = Object.keys(dataPaths.pc ?? {}).sort();

	for (const ver of javaVersionIds) {
		const protocolVersionNumber = protocolVersions.find((v) => v.minecraftVersion === ver)?.version;
		const d = await javaData(ver, dataPaths.pc![ver]);
		await javaModules(ver, d, protocolVersionNumber);
		console.log(`Ingested Java version ${ver}`);
	}

	await generateIndex(javaVersionIds);
	console.log("Generated index.ts");
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

