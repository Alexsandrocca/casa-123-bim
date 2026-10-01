# 00 — Roadmap (not an implementation spec)
Status: reference

| Spec | What the family gets | Status |
|---|---|---|
| 01 | Project setup, building model, 2D plan editor matching the prototype | done |
| 02 | 3D model of site, cut, structure, walls, slabs, stairs, openings, all edited together with 2D | done |
| 02b | Version 3: garage out, covered carport in the front setback, house front moved back 1 m | done |
| 03 | Plumbing: water, hot water, sewage, lift station, rainwater, with slopes and diameters in 3D and 2D, plus checks | done |
| 04 | Electrical: panels, circuits, outlets, lights, solar, cameras, with loads and checks | done |
| 04b | Plumbing and electrical obey the building: service spaces (walls, shafts, ceiling plenums, crawlspace, ground), real routing around voids/openings/structure, every device hosted on a wall face or support, clash and support checks | done |
| 05 | Finishes, colours and style presets (facade and interior) | draft |
| 06 | Furniture and garden library: drag, rotate, snap, clearance checks | draft |
| 08 | Architectural features (brise, pergola, cobogó, skylight…) and engineering estimates: wall/roof assemblies with U-value and weight, loads, column/beam/footing pre-sizing, environmental checks, cost estimate | ready |
| 09 | Reference images board: upload photos with notes, palette extraction, AI analysis (API key or via the manager), proposals the owner accepts into the model | ready |
| 10 | Generate a complete new design version from reference photos + prompts (layout, walls, facade, roof, materials), checked and self-repaired, options compared side by side | ready |
| 07 | Exports: IFC 4 for the architect and engineers, quantities, PDF sheets; plus deploy | draft |

The manager changes `draft` to `ready` after reviewing the previous phase with the owner.

## Principles for every phase
- **One model:** every view and check reads the same model.
- **Precision:** metres with 5 mm internal resolution, snapping at 5 cm.
- **BIM-like:** every element has a type, properties, a level and an id. Quantities come from the model.
- **Honesty:** the app is a design and decision tool. The official permit and executive designs (ART/RRT) are made by licensed professionals from the IFC export. Say so in the About panel.
