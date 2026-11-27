# Illustrations: how they were made

The six `art-*.webp` images are decorative. They were drawn by an image model, not by a script, so they cannot be regenerated as they are: a new run gives new drawings. To redo one, use the brief below with `art-team.webp` as the reference image, so that the set stays one set.

- **Style:** a drafting sheet pinned on a blueprint board: thin, exact ink lines, a sparse composition with much empty paper, muted tints and one red accent, calm and a little wistful.
- **Model:** GPT Image 2.5 Sunburst (OpenAI), quality `high`, resolution `1K`, aspect 2:1 (1280×640).
- **Reference:** `art-team.webp` was drawn first, from a brief alone. The five others were drawn with it attached as the reference image, two variations each, one chosen by eye.
- **After the model:** converted from PNG to WebP at quality 90 with a headless Chrome, as `screenshots.mjs` writes its files.
- **No text in the images**, so they need no translation. The title block of each sheet is empty.
- **Original characters.** The briefs ask for no character of any existing game or film. Describe the person plainly: a bob haircut and a long work coat.

## The brief of `art-team.webp`

> Use: a decorative banner at the top of a software user guide, shown on a web page. Style: an engineering drafting sheet pinned to a blueprint board, with a restrained, quiet elegance: sparse composition, much empty paper, muted tones. Paper: bone white (#F2F0E9) with a fine pale warm-grey grid. Drawn entirely in thin, precise charcoal ink lines (#1A1A19) like a technical drawing, with light hatching for shade and pale khaki-beige flat tints in a few places; the only color accent is tomato red (#E84C3D), on the antenna tips and on one red pencil lying at the bottom edge. Drafting marks surround the figures: construction circles, center lines, dimension lines with arrowheads and tick marks, small empty callout circles on leader lines, registration crosses in the corners, and an empty title block in the lower right corner. Scene, wide: on the left a person stands at a large board of rectangular cards, some marked with a check, and points at one. In the middle a slightly taller robot holds a conductor's baton and leads six smaller robots walking in a row to the right. Each small robot carries one object: a notepad with a magnifying glass, a paint palette, a rolled blueprint, a wrench, a clipboard, and a pair of round glasses. The robots are original designs: hexagon-shaped heads, two small round eyes, a short antenna with a red triangle tip, compact bodies. The figures are clean line drawings, as if specified on the sheet, yet alive and walking. Mood: calm, exact, quiet, a little wistful. Constraints: original characters only, no character from any existing game or film; no text, no letters, no numbers, no logos, no watermark.

The bone white, the ink and the red are the colors of `brand/`.

## The brief of the five others

Each has `art-team.webp` attached as the reference image, and this text with its own scene:

> Use: a decorative banner at the head of a chapter of a software user guide, shown on a web page. The attached reference image sets the style and the characters: draw a new sheet of the same set. Keep from the reference: the bone-white drafting paper with its fine grid, pinned with brass pins on a dark blue blueprint board whose edge shows around the sheet; thin precise charcoal ink lines with light hatching and pale tints; the drafting marks (construction circles, center lines, dimension lines with arrowheads, small empty callout circles on leader lines, registration crosses in the corners, an empty title block in the lower right corner); the same robots, with block-shaped hexagonal heads, two small round eyes, jointed mechanical limbs and a small red triangular flag on the antenna; red as the only color accent. Change: the scene. New scene, wide: *(the scene)*. Constraints: original characters only, no character from any existing game or film; no text, no letters, no numbers, no logos, no watermark.

| File | Scene |
| --- | --- |
| `art-understand.webp` | The taller robot stands beside an easel and points with a pointer stick at a drawing of a winding path with seven round dots and three small flags along it. Two small robots sit on the floor in front of the easel and look up; one of them raises a hand. |
| `art-set-up.webp` | Two small robots carry a crate full of gears and tools toward the open door of a tiny house whose roof is shaped like a file folder. A third small robot stands on a stool and tightens a bolt on the wall of the house with a wrench, an open toolbox beside it. A small potted sprout stands by the door. The house is drawn like an architectural elevation, with dimension lines. |
| `art-first-run.webp` | A path runs from the left edge to the right edge and passes through three archway gates. The person, with a bob haircut and a long work coat, stands beside the middle gate, holds a large rubber stamp with a red handle in one hand and gives a thumbs up with the other. Three small robots move along the path like a relay: one hands a wrapped parcel to the next, and the third waits ahead with open arms. A small red flag stands at the right end of the path. |
| `art-other-ways.webp` | A path forks in two at a wooden signpost whose two arrow boards are blank. On the upper branch a small robot rides a kick scooter, leaning forward, with motion lines behind it. On the lower branch a small robot holds a butterfly net and gently catches a small round beetle. A third small robot stands at the fork and studies an unfolded blank map. |
| `art-reference.webp` | A small library. One small robot stands on a short ladder and takes a book from a tall shelf of books with blank spines. A second small robot sits at a desk and studies an open binder through a big magnifying glass. A third small robot walks in carrying a wrench in one hand and a lantern in the other. |

## What each stands for

| File | In the guide | Stands for |
| --- | --- | --- |
| `art-team.webp` | Top of `USER_GUIDE.md` and of the landing page | The owner at the run board, the Orchestrator, and the six specialists: analyst, designer, architect, developer, tester, reviewer |
| `art-understand.webp` | Part 1 | One run explained: seven steps, three gates of the owner |
| `art-set-up.webp` | Part 2, and "Quick start" of the landing page | The kit moving into a repository |
| `art-first-run.webp` | Part 3, and "What a run looks like" of the landing page | Work handed from agent to agent, through the three gates only the owner opens |
| `art-other-ways.webp` | Part 4 | The light track, a bug run, and choosing between ways |
| `art-reference.webp` | Part 5, and "Documentation" of the landing page | Looking things up, and troubleshooting |
