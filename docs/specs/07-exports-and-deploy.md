# 07 — Exports for professionals, and deploy
Status: draft

## Goal
Hand the model to the architect and engineers without redrawing, and let the family open the app from any device.

## Requirements
1. **IFC 4 export** (use `web-ifc` from That Open Company, or IfcOpenShell in a build script; explain the choice in DECISIONS.md):
   - IfcSite, IfcBuilding, IfcBuildingStorey per level;
   - IfcWall with openings, IfcSlab, IfcColumn, IfcBeam, IfcStair, IfcSpace with names and areas;
   - IfcPipeSegment, IfcFlowTerminal (fixtures), IfcCableSegment, IfcElectricDistributionBoard, IfcOutlet, IfcLightFixture, IfcFurniture;
   - property sets with DN, slope, circuit, power.
   - Validate by re-opening the file with web-ifc in a test, and list what each element became.
2. **Other exports:**
   - DXF plans per level;
   - PDF sheet set (plans, 2 sections, 4 elevations, riser diagram, single-line diagram, site plan with setbacks) at 1:50 / 1:100 with a title block "Casa 123 — design study, not for construction";
   - CSV schedules (rooms, finishes, plumbing, electrical, furniture);
   - glTF of the 3D model.
3. **Versions:** save named snapshots (e.g. "Version 2", "Version 2 + pool"). Compare two snapshots with a simple list of changes and an area difference.
4. **Deploy:** Vercel, as a static app. Password-protect the preview if Vercel allows it on the plan; otherwise add a simple passphrase gate and note that it is not strong security. No personal data in the repo.
5. **Handoff note:** `docs/HANDOFF.md` for the architect: what the model contains, its assumptions (no topographic survey, sewer depth assumed) and which files to import into Revit, Archicad or QiBuilder.

## Acceptance
- The IFC opens in a free IFC viewer (test with web-ifc re-read; the owner can check it in BIMvision or the That Open viewer).
- The PDF sheet set is generated from the current model in one click.
