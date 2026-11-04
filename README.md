# Battle Plan — P2P fleet combat

Two commanders draft a fleet and write standing orders. Then the ships fly
themselves. Pause the battle (a limited number of times) to rewrite the plan.

Play it: **https://kyleleesea.github.io/spaceship/**

## How it works

- **Peer-to-peer.** Browsers connect directly over WebRTC (PeerJS data channel).
  The only server involved is PeerJS's public signaling broker, used once to
  exchange connection details. No game state ever touches a server.
- **Lockstep determinism.** Both machines run the identical simulation and
  exchange only the orders each player issued per 100 ms turn. Inputs are
  scheduled two turns ahead to hide latency. Every turn, each peer hashes its
  world state and sends the hash along with its next input; a mismatch is
  flagged as a desync. The simulation avoids every source of cross-engine
  floating-point drift: no `Math.sin/cos/atan2/pow/random`, only `+ - * /`,
  `sqrt`, integer ops, a polynomial sine, and a seeded mulberry32 RNG.
- **Pause to re-plan.** Each commander gets N pauses of up to M seconds. Pause
  and resume are themselves lockstep inputs, so both peers agree on exactly
  which tick the battle froze. While paused, both sides may rewrite orders.
- **Rebalance.** The host sets per-player budgets, pause counts, pause length,
  the time limit, whether orders can be changed live without pausing, and a
  loser bonus that grows the losing fleet's budget on each rematch.

## Fleet building

| Hull | Cost | HP | Speed | Weapons | Modules |
|---|---|---|---|---|---|
| Interceptor | 4 | 190 | 230 | 1 | 1 |
| Frigate | 6 | 420 | 150 | 2 | 1 |
| Cruiser | 11 | 860 | 95 | 3 | 2 |

Weapons: Pulse Laser (hitscan, armor-weak), Railgun (forward arc, armor-strong,
misses nimble targets), Missiles (long range homing, flak-vulnerable), Flak
(short range splash, point defense). Modules: Shield, Armor, Afterburner,
Repair Nanites.

Orders per ship: stance (assault / kite / brawl / guard ally / hold), target
priority (nearest / weakest / most dangerous / largest / smallest / focus #),
retreat threshold.

## Development

```
npm test          # determinism + lockstep pair test
node test/balance.mjs   # preset round-robin win rates
python3 -m http.server 8080   # then open http://localhost:8080
```

Everything is static: `index.html`, `style.css`, `src/*.js`. PeerJS is loaded
from a CDN.
