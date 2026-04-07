# minecraft-data-next

`node-minecraft-data` if it was written today. Tree-shaken, ESM-only, protocol type generation.

```ts
import type { Packets } from "minecraft-data-next/protocol/1.21";
type Alias = Packets.Play.Server.ChatMessage;
type PacketMap = Packets.Play.Server.PacketMap;

// import .../java/<version>
import { blocks, items, type Blocks, type Items } from "minecraft-data-next/java/1.21";

// import .../java/<version>/<type>
import { blocks } from "minecraft-data-next/java/1.21/blocks";
```

## Development

```bash
pnpm run sync:upstream
pnpm run generate
pnpm run build
```
