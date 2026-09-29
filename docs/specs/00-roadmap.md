# 00 — Roadmap (not an implementation spec)
Status: reference

| Spec | What the family gets | Status |
|---|---|---|
| 01 | Project setup, building model, 2D plan editor matching the prototype | ready |
| 02 | 3D model of site, cut, structure, walls, slabs, stairs, openings, all edited together with 2D | ready |
| 02b | Version 3: garage out, covered carport in the front setback, house front moved back 1 m | ready |
| 03 | Plumbing: water, hot water, sewage, lift station, rainwater, with slopes and diameters in 3D and 2D, plus checks | draft |
| 04 | Electrical: panels, circuits, outlets, lights, solar, cameras, with loads and checks | draft |
| 05 | Finishes, colours and style presets (facade and interior) | draft |
| 06 | Furniture and garden library: drag, rotate, snap, clearance checks | draft |
| 07 | Exports: IFC 4 for the architect and engineers, quantities, PDF sheets; plus deploy | draft |

The manager changes `draft` to `ready` after reviewing the previous phase with the owner.

## Principles for every phase
- **One model:** every view and check reads the same model.
- **Precision:** metres with 5 mm internal resolution, snapping at 5 cm.
- **BIM-like:** every element has a type, properties, a level and an id. Quantities come from the model.
- **Honesty:** the app is a design and decision tool. The official permit and executive designs (ART/RRT) are made by licensed professionals from the IFC export. Say so in the About panel.
