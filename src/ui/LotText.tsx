// P1: the words for the lot's "to confirm" list and for whom to ask, in the UI language.
import type { ConfirmGroup, ConfirmItem } from '../model/lot';
import type { Who } from '../model/schema';
import type { useT } from '../i18n/useT';

type T = ReturnType<typeof useT>;

export const whoLabel = (t: T, who: Who) => ({
  prefeitura: t('City hall (Prefeitura)'),
  water: t('Water and sewer company'),
  power: t('Electric utility'),
  gas: t('Gas company'),
  surveyor: t('Surveyor (topographic survey)'),
  soil: t('Soil investigation company'),
  engineer: t('Architect or engineer'),
})[who];

export function confirmText(t: T, item: ConfirmItem): string {
  switch (item.code) {
    case 'zone': return t('The zone of the lot and its rules');
    case 'setbacks': return t('Setbacks (front, rear and sides)');
    case 'rates': return t('Site coverage (TO), permeable area (TP) and floor-area ratio (CA)');
    case 'height': return t('Height limit and number of floors');
    case 'eaves': return t('How deep the eaves may be without counting in site coverage');
    case 'carport': return t('A covered carport in the front setback, and how it counts in site coverage');
    case 'storm': return t('Where the rainwater goes: storm drain or street gutter');
    case 'sewer-exists': return t('Is there a public sewer in the street?');
    case 'sewer-depth': return t('Depth of the public sewer');
    case 'water-depth': return t('Depth of the water main');
    case 'supply': return t('Supply type: voltage, single- or three-phase');
    case 'gas': return t('Piped gas in the street');
    case 'survey': return t('Topographic survey (the slope is an estimate)');
    case 'shape': return t('The lot measurements and corners');
    case 'geo': return t('The position on the map and north');
    default: return t(item.text ?? '');
  }
}

/** The list grouped by whom to ask: "Prefeitura — …", "SEMAE (water and sewer company) — …". */
export function ConfirmList({ t, groups, testId }: { t: T; groups: ConfirmGroup[]; testId?: string }) {
  if (!groups.length) return <p className="hint">{t('Nothing left to confirm.')}</p>;
  return (
    <ul className="confirmlist" data-testid={testId}>
      {groups.map((g) => (
        <li key={g.who} data-who={g.who}>
          <b>{/^[A-Z]/.test(g.ask) && g.who !== 'prefeitura' ? `${g.ask} · ${whoLabel(t, g.who)}` : whoLabel(t, g.who)}</b>
          <ul>{g.items.map((it, i) => <li key={i}>{confirmText(t, it)}</li>)}</ul>
        </li>
      ))}
    </ul>
  );
}
