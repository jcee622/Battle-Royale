# Last Drop

A first-person 3D battle royale built with Three.js. The island, houses, terrain, trees, grass, characters, and their materials are generated locally; the game does not depend on downloaded models or image assets.

## Run locally

Install Node.js 20.19+ or 22.12+, then run these commands in this folder:

```sh
npm install
npm run dev
```

Open the local URL Vite prints (normally `http://127.0.0.1:5173`). A local web server is required for the 3D module; opening `index.html` as a `file://` URL will not work.

Create a distributable build with `npm run build`. The production site is written to `dist`.

## Controls

- **WASD** — move
- **Mouse** — look and aim (click the game to capture the mouse)
- **Left click** — fire
- **Shift** — sprint
- **R** — reload
- **E** — use a medkit
- **Esc** — release the mouse and pause; click the game to resume
- **Touchscreens** — use the left joystick to move, drag the right side to aim, and hold **FIRE** to shoot. On-screen buttons reload and use a medkit.

Eliminate all nine opponents while collecting ammo and medkits. Stay inside the shrinking safe zone.
