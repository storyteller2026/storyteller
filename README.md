# Storyteller

Interactive AI stories where **you** are the main character. The first story is **Room 9**, a five-episode mystery set in a snowed-in Colorado lodge.

- **Story plan:** an AI narrator writes every scene around the player's choices.
- **Illustrated plan:** adds pictures, with the player drawn into them from their own portrait (made from a selfie or a description).
- **Cinematic plan:** adds a short video clip of the player at every cliffhanger.

Everything that costs money runs on the server, behind a beta code. The story's solution also stays on the server, so players can't read it in the page source.

## Set it up on Vercel (about 15 minutes)

1. **Create the project.** Sign in to [vercel.com](https://vercel.com) with GitHub → **Add New → Project** → import `storyteller2026/storyteller`. Leave every build setting at its default and choose **Deploy**. The app runs right away in setup mode, with a stand-in narrator and placeholder pictures.
2. **Add storage for pictures.** In the project, open **Storage → Create → Blob**, and connect it to the project. This adds `BLOB_READ_WRITE_TOKEN` for you.
3. **Add your keys.** In **Settings → Environment Variables**, add:

   | Name | What it is |
   |---|---|
   | `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) → API keys. Writes the story. |
   | `REPLICATE_API_TOKEN` | From Replicate → Account → API tokens. Draws pictures and clips. |
   | `BETA_CODE` | Any word your testers must enter, e.g. `snowedin`. |
   | `ADMIN_CODE` | A private code for the admin page. |
   | `APP_SECRET` | Any long random string. |

4. **Redeploy** (Deployments → ⋯ → Redeploy) so the new settings take effect.
5. **Open `/admin.html`** on your site and enter the admin code. Check that every line of the setup checklist says READY, then:
   - **Draw any missing portraits** (9 cast members, about 3–5¢ each).
   - **Draw any missing scenes** (12 shared scenes, drawn once for every reader).
   - **Make a test clip** to confirm the video model works.
6. Open your site, enter the beta code and play.

## What it costs to run

Rough estimates per complete playthrough of Room 9 (about 35 scenes):

| Layer | Cost |
|---|---|
| Narrator text | ~15–35¢ |
| Pictures of the player (capped at 4 per episode + 5 cliffhangers) | ~45¢–$1 |
| Cliffhanger clips (5) | ~$1–1.50 |
| Player portrait (once per player) | ~4–15¢ |

Shared scenes and cast portraits are drawn once and then free for every reader.

## Privacy and safety

- **Selfies are never stored.** The photo is shrunk on the player's device, sent once to Anthropic (to describe the look) and Replicate (to draw the portrait), and dropped when the portrait is approved. Only the drawn portrait is kept, at an unguessable address.
- Players confirm the photo is their own face and that they're 18 or older; photos that look like a minor are refused.
- 18+ gate, a persistent "AI-written" label, and a crisis check that steps out of the story with 988 information.
- Image models run at strict safety settings.
- **Before a public launch:** have a lawyer review the consent wording, terms, a privacy policy, biometric-privacy rules (Illinois BIPA, Texas CUBI) and California SB 243.

## How it's built

No build step and no dependencies: static pages in `public/` and Vercel serverless functions in `api/`.

| Path | What it does |
|---|---|
| `lib/stories/room9.js` | The story bible, clues, episodes, cast looks and shared shots (server-only) |
| `lib/engine.js` | Builds the narrator's instructions and enforces the rules: clue gating, pacing, episode endings, verdicts |
| `api/turn.js` | Streams the next scene |
| `api/accuse.js` | Judges the accusation and streams the ending |
| `api/describe.js` | Reads a selfie into a written description |
| `api/media.js` | Portraits, scenes, shared art and clips (Replicate), stored in Vercel Blob |
| `public/` | The reader app and the admin page |

Models (change with environment variables): narrator `claude-sonnet-5-5` (Fast: `claude-haiku-5-5`), pictures `black-forest-labs/flux-2-pro`, portraits from photos `black-forest-labs/flux-kontext-pro`, clips `minimax/h3-lite`.

### Run it locally

```
node scripts/dev-server.mjs   # http://localhost:3000, reads .env if present
node scripts/test.mjs         # engine checks
```
