import { readJson, writeText } from "./util.js";

const pkg = await readJson<{
	version: string;
}>("package.json");

const version = pkg.version.split("+")[0];

pkg.version = version + "+" + new Date().toISOString().split("T")[0].replace(/-/g, "_");

writeText("package.json", JSON.stringify(pkg, null, "\t"));
