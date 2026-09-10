export interface CooperativeTypeSeed {
  key: string
  nameEn: string
  nameRw: string
  descriptionEn: string
  descriptionRw: string
  iconKey: string
  defaultUnitKeys: string[]
  suggestedCategories: { income: string[]; expense: string[]; products: string[] }
  sortOrder: number
}

/**
 * Cooperative types configure defaults only. No feature branches on the type: a dairy cooperative
 * and a handicraft cooperative run identical code and differ in seeded units, suggested categories
 * and one label.
 */
export const COOPERATIVE_TYPES: CooperativeTypeSeed[] = [
  {
    key: 'AGRICULTURE',
    nameEn: 'Agriculture',
    nameRw: 'Ubuhinzi',
    descriptionEn: 'Crop farming, produce collection and sale',
    descriptionRw: 'Guhinga, gukusanya no kugurisha umusaruro',
    iconKey: 'wheat',
    defaultUnitKeys: ['KG', 'TONNE', 'BAG', 'SACK'],
    suggestedCategories: {
      income: ['Sale of produce', 'Membership fees', 'Grants'],
      expense: ['Seeds', 'Fertiliser', 'Transport', 'Packaging', 'Labour'],
      products: ['Maize', 'Beans', 'Irish potatoes', 'Rice'],
    },
    sortOrder: 1,
  },
  {
    key: 'DAIRY',
    nameEn: 'Dairy',
    nameRw: 'Amata',
    descriptionEn: 'Milk collection, cooling and sale',
    descriptionRw: 'Gukusanya, gukonjesha no kugurisha amata',
    iconKey: 'milk',
    defaultUnitKeys: ['LITRE', 'KG', 'CRATE'],
    suggestedCategories: {
      income: ['Milk sales', 'Membership fees'],
      expense: ['Transport', 'Cooling and electricity', 'Testing', 'Animal feed'],
      products: ['Fresh milk', 'Yoghurt'],
    },
    sortOrder: 2,
  },
  {
    key: 'COFFEE',
    nameEn: 'Coffee',
    nameRw: 'Ikawa',
    descriptionEn: 'Cherry collection, washing and export sale',
    descriptionRw: 'Gukusanya, gutunganya no kugurisha ikawa',
    iconKey: 'coffee',
    defaultUnitKeys: ['KG', 'TONNE', 'BAG'],
    suggestedCategories: {
      income: ['Cherry sales', 'Parchment sales', 'Premiums'],
      expense: ['Washing station', 'Transport', 'Certification', 'Labour'],
      products: ['Coffee cherry', 'Parchment coffee'],
    },
    sortOrder: 3,
  },
  {
    key: 'LIVESTOCK',
    nameEn: 'Livestock',
    nameRw: 'Amatungo',
    descriptionEn: 'Animal rearing and sale',
    descriptionRw: 'Korora no kugurisha amatungo',
    iconKey: 'beef',
    defaultUnitKeys: ['UNIT', 'KG'],
    suggestedCategories: {
      income: ['Animal sales', 'Membership fees'],
      expense: ['Feed', 'Veterinary', 'Transport'],
      products: ['Goats', 'Pigs', 'Chickens'],
    },
    sortOrder: 4,
  },
  {
    key: 'HANDICRAFTS',
    nameEn: 'Handicrafts',
    nameRw: 'Ubukorikori',
    descriptionEn: 'Craft production and sale',
    descriptionRw: 'Gukora no kugurisha ibikorwa byamaboko',
    iconKey: 'palette',
    defaultUnitKeys: ['PIECE', 'UNIT', 'BOX'],
    suggestedCategories: {
      income: ['Craft sales', 'Exhibition sales', 'Membership fees'],
      expense: ['Raw materials', 'Transport', 'Exhibition fees'],
      products: ['Agaseke baskets', 'Woven mats', 'Pottery'],
    },
    sortOrder: 5,
  },
  {
    key: 'TRADING',
    nameEn: 'Trading',
    nameRw: 'Ubucuruzi',
    descriptionEn: 'Buying and reselling goods',
    descriptionRw: 'Kugura no kongera kugurisha ibicuruzwa',
    iconKey: 'store',
    defaultUnitKeys: ['UNIT', 'BOX', 'KG'],
    suggestedCategories: {
      income: ['Sales', 'Membership fees'],
      expense: ['Stock purchase', 'Rent', 'Transport'],
      products: [],
    },
    sortOrder: 6,
  },
  {
    key: 'TRANSPORT',
    nameEn: 'Transport',
    nameRw: 'Ubwikorezi',
    descriptionEn: 'Passenger and goods transport services',
    descriptionRw: 'Gutwara abantu nibintu',
    iconKey: 'truck',
    defaultUnitKeys: ['TRIP', 'HOUR', 'UNIT'],
    suggestedCategories: {
      income: ['Fares', 'Freight', 'Membership fees'],
      expense: ['Fuel', 'Maintenance', 'Insurance', 'Licences'],
      products: [],
    },
    sortOrder: 7,
  },
  {
    key: 'MANUFACTURING',
    nameEn: 'Manufacturing',
    nameRw: 'Inganda',
    descriptionEn: 'Processing and production',
    descriptionRw: 'Gutunganya no gukora ibicuruzwa',
    iconKey: 'factory',
    defaultUnitKeys: ['KG', 'UNIT', 'BOX', 'LITRE'],
    suggestedCategories: {
      income: ['Product sales', 'Contract processing'],
      expense: ['Raw materials', 'Electricity', 'Maintenance', 'Labour'],
      products: [],
    },
    sortOrder: 8,
  },
  {
    key: 'SERVICES',
    nameEn: 'Services',
    nameRw: 'Serivisi',
    descriptionEn: 'Service delivery cooperatives',
    descriptionRw: 'Koperative zitanga serivisi',
    iconKey: 'briefcase',
    defaultUnitKeys: ['HOUR', 'UNIT'],
    suggestedCategories: {
      income: ['Service fees', 'Membership fees'],
      expense: ['Salaries', 'Equipment', 'Rent'],
      products: [],
    },
    sortOrder: 9,
  },
  {
    key: 'OTHER',
    nameEn: 'Other',
    nameRw: 'Ibindi',
    descriptionEn: 'Any cooperative that does not fit the categories above',
    descriptionRw: 'Koperative itari mu byiciro biri hejuru',
    iconKey: 'circle-dashed',
    defaultUnitKeys: ['UNIT', 'KG'],
    suggestedCategories: {
      income: ['Membership fees'],
      expense: ['Operating costs'],
      products: [],
    },
    sortOrder: 10,
  },
]
