export type ProtocolVersionEntry = {
	minecraftVersion: string;
	majorVersion: string;
	releaseType: string;
	version: number;
	dataVersion: number;
};

export type DataPaths = {
	pc?: Record<string, Record<string, string>>;
};
