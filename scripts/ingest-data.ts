import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

type ProtocolVersionEntry = {
	minecraftVersion: string;
	majorVersion: string;
	releaseType: string;
	version: number;
	dataVersion: number;
};

type DataPaths = {
	pc?: Record<string, Record<string, string>>;
};

type JavaTrack = {
	javaVersion: string;
	releaseVersion: string;
	sourceDataVersion: string;
};

const rootDir = process.cwd();
const upstreamDataDir = path.join(rootDir, "vendor", "minecraft-data", "data");
const commonDir = path.join(upstreamDataDir, "pc", "common");
const generatedDataRoot = path.join(rootDir, "src", "generated", "data", "java");
const generatedMetaRoot = path.join(rootDir, "src", "generated", "meta");
const javaSourceRoot = path.join(rootDir, "src", "java");

const trackCount = Number.parseInt(process.env.MDN_TRACK_COUNT ?? "2", 10);
if (!Number.isFinite(trackCount) || trackCount < 1) {
	throw new Error("MDN_TRACK_COUNT must be a positive integer");
}

function parseNumericVersion(version: string): number[] | null {
	if (!/^\d+(?:\.\d+)*$/.test(version)) {
		return null;
	}
	return version.split(".").map((part) => Number.parseInt(part, 10));
}

function compareNumericVersions(a: string, b: string): number {
	const left = parseNumericVersion(a);
	const right = parseNumericVersion(b);

	if (!left || !right) {
		return a.localeCompare(b);
	}

	const maxLen = Math.max(left.length, right.length);
	for (let i = 0; i < maxLen; i += 1) {
		const leftPart = left[i] ?? 0;
		const rightPart = right[i] ?? 0;
		if (leftPart !== rightPart) {
			return leftPart - rightPart;
		}
	}

	return 0;
}

function toPascalCase(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9]+(.)/g, (_, chr: string) => chr.toUpperCase())
		.replace(/^./, (chr) => chr.toUpperCase());
}

function toCamelCase(value: string): string {
	const pascal = toPascalCase(value);
	return pascal.slice(0, 1).toLowerCase() + pascal.slice(1);
}

function toVersionIdentifier(version: string): string {
	return `v${version.replace(/[^a-zA-Z0-9]+/g, "_")}`;
}

async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function writeText(filePath: string, content: string): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, content, "utf8");
}

function resolveSourceDataVersion(
	entry: ProtocolVersionEntry,
	releases: ProtocolVersionEntry[],
	dataPathsByVersion: Record<string, Record<string, string>>,
	fallbackDataVersion: string
): string | null {
	if (dataPathsByVersion[entry.minecraftVersion]) {
		return entry.minecraftVersion;
	}

	const sameProtocolReleases = releases.filter(
		(candidate) => candidate.version === entry.version && candidate.releaseType === "release"
	);

	for (const candidate of sameProtocolReleases) {
		if (dataPathsByVersion[candidate.minecraftVersion]) {
			return candidate.minecraftVersion;
		}
	}

	return fallbackDataVersion;
}

function selectJavaTracks(
	protocolVersions: ProtocolVersionEntry[],
	dataPathsByVersion: Record<string, Record<string, string>>
): JavaTrack[] {
	const releases = protocolVersions.filter((entry) => entry.releaseType === "release");
	const byJavaVersion = new Map<string, ProtocolVersionEntry[]>();

	for (const entry of releases) {
		if (!/^\d+\.\d+$/.test(entry.majorVersion)) {
			continue;
		}

		const track = byJavaVersion.get(entry.majorVersion) ?? [];
		track.push(entry);
		byJavaVersion.set(entry.majorVersion, track);
	}

	const candidateVersions = [...byJavaVersion.keys()].sort(compareNumericVersions);
	const selectedJavaVersions = candidateVersions.slice(-trackCount);
	const fallbackDataVersion = Object.keys(dataPathsByVersion)
		.filter((version) => /^\d+(?:\.\d+)+$/.test(version))
		.sort(compareNumericVersions)
		.at(-1);

	if (!fallbackDataVersion) {
		throw new Error("Unable to determine fallback data version from upstream dataPaths.");
	}

	const tracks: JavaTrack[] = [];

	for (const javaVersion of selectedJavaVersions) {
		const entries = (byJavaVersion.get(javaVersion) ?? []).sort((a, b) => b.dataVersion - a.dataVersion);

		let chosen: JavaTrack | null = null;
		for (const entry of entries) {
			const sourceDataVersion = resolveSourceDataVersion(
				entry,
				releases,
				dataPathsByVersion,
				fallbackDataVersion
			);
			if (!sourceDataVersion) {
				continue;
			}

			chosen = {
				javaVersion,
				releaseVersion: entry.minecraftVersion,
				sourceDataVersion
			};
			break;
		}

		if (!chosen) {
			throw new Error(`Could not map java version ${javaVersion} to a dataPaths entry.`);
		}

		tracks.push(chosen);
	}

	return tracks.sort((a, b) => compareNumericVersions(a.javaVersion, b.javaVersion));
}

async function copyVersionData(
	javaVersion: string,
	sourcePaths: Record<string, string>
): Promise<string[]> {
	const outputDir = path.join(generatedDataRoot, javaVersion);
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

		await copyFile(sourcePath, targetPath);
		domainFiles.add(`${domainName}.json`);
	}

	return [...domainFiles].sort();
}

async function generateVersionModules(javaVersion: string, domainFiles: string[]): Promise<void> {
	const versionSourceDir = path.join(javaSourceRoot, javaVersion);
	await mkdir(versionSourceDir, { recursive: true });

	const exports: string[] = [];

	for (const fileName of domainFiles) {
		const domain = fileName.slice(0, -5);
		if (domain === "protocol") {
			continue;
		}

		const symbolName = toCamelCase(domain);
		const typeName = toPascalCase(domain);

		const moduleSource = [
			`import data from "../../generated/data/java/${javaVersion}/${fileName}" with { type: "json" };`,
			`export const ${symbolName} = data;`,
			`export type ${typeName} = typeof ${symbolName};`,
			""
		].join("\n");

		await writeText(path.join(versionSourceDir, `${domain}.ts`), moduleSource);
		exports.push(`export * from "./${domain}.js";`);
	}

	await writeText(path.join(versionSourceDir, `packets.ts`), [
		`export * from "../../generated/protocol/java/${javaVersion}/index.js";`
	].join("\n"));
	exports.push(`export * from "./packets.js";`);

	exports.push("");

	await writeText(path.join(versionSourceDir, "index.ts"), `${exports.join("\n")}\n`);
}

async function generateJavaIndex(javaVersions: string[]): Promise<void> {
	const loaderEntries = javaVersions.map(
		(version) => `  "${version}": () => import("./${version}/index.js")`
	);

	const namespaceExports = javaVersions
		.map((version) => `export * as ${toVersionIdentifier(version)} from "./${version}/index.js";`)
		.join("\n");

	const source = [
		"import { selectedJavaVersions } from \"../generated/meta/selected-versions.js\";",
		"",
		"export const javaVersions = selectedJavaVersions;",
		"",
		"const javaVersionLoaders = {",
		loaderEntries.join(",\n"),
		"} as const;",
		"",
		"export type JavaVersion = keyof typeof javaVersionLoaders;",
		"export type JavaVersionModule = Awaited<ReturnType<(typeof javaVersionLoaders)[JavaVersion]>>;",
		"",
		"export async function loadJavaVersion(version: JavaVersion): Promise<JavaVersionModule> {",
		"  return javaVersionLoaders[version]();",
		"}",
		"",
		namespaceExports,
		""
	].join("\n");

	await writeText(path.join(javaSourceRoot, "index.ts"), source);
}

const protocolVersions = await readJson<ProtocolVersionEntry[]>(
	path.join(commonDir, "protocolVersions.json")
);
const dataPaths = await readJson<DataPaths>(path.join(upstreamDataDir, "dataPaths.json"));
const pcDataPaths = dataPaths.pc ?? {};

const selectedTracks = selectJavaTracks(protocolVersions, pcDataPaths);
if (selectedTracks.length === 0) {
	throw new Error("No java release versions selected.");
}

await rm(generatedDataRoot, { recursive: true, force: true });
await rm(path.join(rootDir, "src", "generated", "protocol", "java"), {
	recursive: true,
	force: true
});
await rm(javaSourceRoot, { recursive: true, force: true });
await mkdir(generatedMetaRoot, { recursive: true });

for (const track of selectedTracks) {
	const sourcePaths = pcDataPaths[track.sourceDataVersion];
	const domainFiles = await copyVersionData(track.javaVersion, sourcePaths);
	await generateVersionModules(track.javaVersion, domainFiles);
}

const javaVersions = selectedTracks.map((track) => track.javaVersion);
await generateJavaIndex(javaVersions);

await writeText(
	path.join(generatedMetaRoot, "selected-versions.json"),
	`${JSON.stringify(javaVersions, null, 2)}\n`
);
await writeText(
	path.join(generatedMetaRoot, "selected-versions.ts"),
	[
		"export const selectedJavaVersions = [",
		...javaVersions.map((version) => `  \"${version}\",`),
		"] as const;",
		""
	].join("\n")
);

await writeText(
	path.join(generatedMetaRoot, "resolved-java-tracks.json"),
	`${JSON.stringify(selectedTracks, null, 2)}\n`
);
