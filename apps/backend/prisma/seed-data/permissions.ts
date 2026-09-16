import { ALL_PERMISSIONS, type PermissionKey } from '@coopmanage/shared'

/**
 * Bilingual descriptions for the permission catalogue. The keys themselves come from
 * `@coopmanage/shared`, so this file cannot invent a permission that the code does not know about;
 * the seed fails loudly if a key is missing a description.
 */
export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, { en: string; rw: string }> = {
  'dashboard:view': { en: 'Open the dashboard', rw: 'Gufungura incamake' },
  'search:use': { en: 'Use global search', rw: 'Gukoresha ubushakashatsi' },
  'assistant:use': { en: 'Use Ask CoopManage', rw: 'Gukoresha ubufasha bwa CoopManage' },
  'notifications:view': {
    en: 'Read and dismiss own notifications',
    rw: 'Gusoma no gukuraho amamenyesha ye',
  },
  'cooperative:view': { en: 'See the cooperative profile', rw: 'Kureba umwirondoro wa koperative' },
  'cooperative:update': {
    en: 'Edit the cooperative profile',
    rw: 'Guhindura umwirondoro wa koperative',
  },
  'settings:manage': {
    en: 'Change cooperative-wide settings',
    rw: 'Guhindura igenamiterere rya koperative',
  },
  'staff:view': { en: 'See staff and their roles', rw: "Kureba abakozi n'imirimo yabo" },
  'staff:invite': { en: 'Invite a new staff user', rw: 'Gutumira umukozi mushya' },
  'staff:manage': { en: 'Change or deactivate staff', rw: 'Guhindura cyangwa guhagarika umukozi' },
  'audit:view': { en: 'Read the audit log', rw: "Gusoma urutonde rw'ibikorwa" },
  'members:view': { en: 'List and open member records', rw: 'Kureba abanyamuryango' },
  'members:create': { en: 'Register a member', rw: 'Kwandika umunyamuryango' },
  'members:update': { en: 'Edit member details', rw: "Guhindura amakuru y'umunyamuryango" },
  'members:deactivate': { en: 'Deactivate or suspend a member', rw: 'Guhagarika umunyamuryango' },
  'members:export': { en: 'Export member lists', rw: "Gukuramo urutonde rw'abanyamuryango" },
  'shares:view': { en: 'See share holdings', rw: 'Kureba imigabane' },
  'shares:manage': { en: 'Record share purchase or transfer', rw: 'Kwandika imigabane' },
  'contributions:view': { en: 'See contributions', rw: 'Kureba imisanzu' },
  'contributions:create': { en: 'Record a contribution', rw: 'Kwandika umusanzu' },
  'contributions:void': { en: 'Void a contribution', rw: 'Gukuraho umusanzu' },
  'finance:view': { en: 'See transactions and balances', rw: 'Kureba amafaranga' },
  'finance:create': {
    en: 'Record income and expenses',
    rw: "Kwandika amafaranga yinjiye n'ayasohotse",
  },
  'finance:void': {
    en: 'Void and reverse a transaction',
    rw: 'Gukuraho no gusubiza inyuma ikorwa',
  },
  'finance:export': { en: 'Export financial data', rw: "Gukuramo amakuru y'amafaranga" },
  'finance:categories:manage': {
    en: 'Manage income and expense categories',
    rw: "Gucunga ibyiciro by'amafaranga",
  },
  'products:view': { en: 'See the product catalogue', rw: 'Kureba ibicuruzwa' },
  'products:manage': { en: 'Create and edit products', rw: 'Gushyiraho no guhindura ibicuruzwa' },
  'units:manage': { en: 'Create and edit units of measure', rw: 'Gushyiraho no guhindura ibipimo' },
  'warehouses:manage': {
    en: 'Create and edit storage locations',
    rw: 'Gushyiraho no guhindura ibigega',
  },
  'inventory:view': { en: 'See stock levels and movements', rw: 'Kureba ububiko' },
  'inventory:receive': { en: 'Record stock received', rw: 'Kwakira ibicuruzwa' },
  'inventory:issue': { en: 'Record stock issued', rw: 'Gusohora ibicuruzwa' },
  'inventory:adjust': { en: 'Record a stock adjustment', rw: 'Kugenzura no guhindura ububiko' },
  'inventory:transfer': { en: 'Move stock between locations', rw: 'Kwimura ibicuruzwa' },
  'buyers:view': { en: 'See buyers and their history', rw: 'Kureba abaguzi' },
  'buyers:manage': { en: 'Create and edit buyers', rw: 'Gushyiraho no guhindura abaguzi' },
  'sales:view': { en: 'See sales and receipts', rw: 'Kureba amagurisha' },
  'sales:create': { en: 'Create and edit a draft sale', rw: 'Gutegura igurisha' },
  'sales:confirm': { en: 'Confirm a sale', rw: 'Kwemeza igurisha' },
  'sales:cancel': { en: 'Cancel a confirmed sale', rw: 'Guhagarika igurisha ryemejwe' },
  'reports:view': { en: 'Open and preview reports', rw: 'Kureba raporo' },
  'reports:export': { en: 'Download reports', rw: 'Gufata raporo' },
  'documents:view': { en: 'List and download documents', rw: 'Kureba inyandiko' },
  'documents:upload': { en: 'Upload documents', rw: 'Kohereza inyandiko' },
  'documents:archive': { en: 'Archive a document', rw: 'Kubika inyandiko mu bubiko' },
  'meetings:view': { en: 'See meetings and decisions', rw: "Kureba inama n'ibyemezo" },
  'meetings:manage': { en: 'Create and edit meetings', rw: 'Gutegura no guhindura inama' },
  'announcements:view': { en: 'Read announcements', rw: 'Gusoma amatangazo' },
  'announcements:manage': {
    en: 'Create and publish announcements',
    rw: 'Gutegura no gutangaza amatangazo',
  },
  'sms:send': { en: 'Send SMS to selected members', rw: 'Kohereza SMS ku banyamuryango' },
  'platform:cooperatives:view': { en: 'List every cooperative', rw: 'Kureba koperative zose' },
  'platform:cooperatives:manage': {
    en: 'Create and suspend cooperatives',
    rw: 'Gushyiraho no guhagarika koperative',
  },
  'platform:users:view': { en: 'List platform users', rw: 'Kureba abakoresha sisitemu' },
  'platform:users:manage': {
    en: 'Create and suspend platform users',
    rw: 'Gucunga abakoresha sisitemu',
  },
  'platform:settings:manage': {
    en: 'Edit platform settings',
    rw: 'Guhindura igenamiterere rya sisitemu',
  },
  'platform:health:view': { en: 'See system health', rw: 'Kureba imikorere ya sisitemu' },
  'platform:audit:view': {
    en: 'Read audit logs across cooperatives',
    rw: 'Gusoma ibikorwa muri koperative zose',
  },
}

/** Guards against a permission being added to the catalogue without a description. */
export function assertDescriptionsComplete(): void {
  const missing = ALL_PERMISSIONS.filter((key) => !PERMISSION_DESCRIPTIONS[key])
  if (missing.length > 0) {
    throw new Error(`Permissions missing a description: ${missing.join(', ')}`)
  }
}
