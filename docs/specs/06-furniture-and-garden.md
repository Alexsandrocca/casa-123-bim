# 06 — Furniture and garden
Status: superseded by docs/product/ROADMAP-v2.md (manager, 2026-10-01)

## Goal
Furnish the house and design the garden by dragging items from a library, with real sizes and clearance checks, so the family can test daily life: beds, crib, dining for 5, desks, washing line, play area.

## Requirements
1. **Furniture library** (simple, clean parametric models; sizes editable):
   - beds (single, double, queen, crib, bunk), wardrobes, desks, sofas, armchairs, dining tables for 4, 6 and 8, chairs;
   - kitchen modules (base, tall, island, fridge, hob, oven), bathroom items, laundry items;
   - TV unit, shelves, bike rack, cars in the garage (two sedans / one SUV).
2. **Placement:**
   - drag, rotate (15° snap), snap to walls; move with arrow keys at 1 cm or 5 cm;
   - duplicate, lock, and hide by category;
   - works in 2D and 3D.
3. **Clearance checks:**
   - 0.60 m beside beds, 0.90 m in circulation paths;
   - door swings not blocked, kitchen work triangle, car doors openable in the garage (0.60 m).
   Warnings show on the item.
4. **Garden** (garden at −2.55 and front setback):
   - trees, shrubs, grass, planters, vegetable beds, paths, deck, pool option (size and depth), play area, washing line, outdoor shower;
   - tree species list suited to Piracicaba (e.g. ipê, jabuticabeira, pitangueira, palms), with the mature canopy size shown;
   - a canopy shadow check with the sun model.
5. **Ramp and outdoor stair:**
   - the north ramp (slope shown, 8.33% accessibility reference vs the current 12.5%);
   - optional outdoor stair from the veranda down to the garden.
6. **Schedule:** a furniture and plant list with counts. Export CSV.

## Acceptance
- A queen bed placed in the master shows a warning if its side clearance is under 0.60 m.
- Two cars fit in the garage with open-door clearance, or a warning shows.
- Screenshots: `docs/screens/06-interior.png`, `06-garden.png`.
