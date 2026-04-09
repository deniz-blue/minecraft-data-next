# minecraft-data-next

`node-minecraft-data` if it was written today. Tree-shaken, ESM-only, protocol type generation.

```ts
import type { Packets } from "minecraft-data-next/protocol/java/773";
// or import from "minecraft-data-next/java/1.21.10/packets"
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

Internal structure:
- `src/` - source code
- `src/java/<version>/<domain>` - generated modules for wrapping other imports
- `src/protocol/java/<protocol number>/index.ts` - generated protocol type definitions
- `src/data/java/<version>/<type>.json` - minecraft-data JSON files
