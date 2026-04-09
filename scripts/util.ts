import { access, mkdir, readFile, writeFile, copyFile } from "fs/promises";
import path from "path";

export async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function writeText(filePath: string, content: string): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, content, "utf8");
	console.log(`WRITE ${filePath}`);
}

export async function copy(source: string, target: string): Promise<void> {
	await mkdir(path.dirname(target), { recursive: true });
	await copyFile(source, target);
	console.log(`COPY ${source} -> ${target}`);
}

export function toPascalCase(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9]+(.)/g, (_, chr: string) => chr.toUpperCase())
		.replace(/^./, (chr) => chr.toUpperCase());
}

export function toCamelCase(value: string): string {
	const pascal = toPascalCase(value);
	return pascal.slice(0, 1).toLowerCase() + pascal.slice(1);
}



