import { isValidEan, nutritionFor, parseOffProduct } from './off';

describe('Open Food Facts – mapowanie', () => {
  it('bierze polską nazwę, markę i wartości na 100 g', () => {
    const p = parseOffProduct({
      code: '5900820000011',
      product_name: 'Skyr natural',
      product_name_pl: 'Skyr naturalny',
      brands: 'Piątnica, Skyr',
      serving_quantity: '150',
      quantity: '150 g',
      nutriments: { 'energy-kcal_100g': 63, proteins_100g: 12, carbohydrates_100g: 3.6, fat_100g: 0 },
    });
    expect(p).toEqual({
      ean: '5900820000011',
      name: 'Skyr naturalny',
      brand: 'Piątnica',
      kcal_100g: 63,
      protein_100g: 12,
      carbs_100g: 3.6,
      fat_100g: 0,
      serving_g: 150,
      quantity: '150 g',
    });
  });

  it('przelicza kJ na kcal, gdy brak kcal', () => {
    const p = parseOffProduct({ code: '1', product_name: 'Chleb', nutriments: { 'energy-kj_100g': 1046 } });
    expect(p?.kcal_100g).toBe(250);
  });

  it('obsługuje format nowego API wyszukiwania (słowniki języków, listy marek)', () => {
    const p = parseOffProduct({
      code: '5900820000011',
      product_name: { main: 'Skyr natural', pl: 'Skyr naturalny' },
      brands: ['Piątnica', 'Skyr'],
      nutriments: { 'energy-kcal_100g': 63 },
    });
    expect(p?.name).toBe('Skyr naturalny');
    expect(p?.brand).toBe('Piątnica');
  });

  it('odrzuca produkty bez nazwy lub kalorii', () => {
    expect(parseOffProduct({ code: '1', nutriments: { 'energy-kcal_100g': 100 } })).toBeNull();
    expect(parseOffProduct({ code: '1', product_name: 'X', nutriments: {} })).toBeNull();
    expect(parseOffProduct(null)).toBeNull();
  });

  it('liczy wartości dla gramatury', () => {
    expect(nutritionFor({ kcal_100g: 63, protein_100g: 12, carbs_100g: 3.6, fat_100g: 0 }, 150)).toEqual({
      kcal: 95,
      protein_g: 18,
      carbs_g: 5.4,
      fat_g: 0,
    });
  });

  it('sprawdza cyfrę kontrolną EAN', () => {
    expect(isValidEan('5901234123457')).toBe(true);
    expect(isValidEan('5901234123458')).toBe(false);
    expect(isValidEan('96385074')).toBe(true);
    expect(isValidEan('abc')).toBe(false);
  });
});
