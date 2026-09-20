/** Kategorie składników do listy zakupów (te same reguły co w imporcie PDF – tools/pdf-import/build.py). */
const CATS: [string, RegExp][] = [
  ['Suplementy', /odżywka/],
  ['Orzechy i nasiona', /orzech|migdał|pestk|nasion|siemi|chia|sezam|słonecznik|masło orzechowe|kokos|tahini/],
  ['Przyprawy i sosy', /sól|pieprz|kumin|kmin|oregano|papryka (ostra|słodka|wędzona) w proszku|curry|kurkum|cynamon|przypraw|zioł|sos|ocet|musztard|ketchup|koncentrat|bulion|tymianek|majeranek|chili|wanili|kakao|miód|syrop|ksylitol|erytrol|słodzik|cukier|pesto|drożdż|proszek do pieczenia|żelatyn|chrzan|czarnuszk|gałka|kardamon|liść laurow|rozmaryn|ziele angiel/],
  ['Tłuszcze', /oliwa|oliwy|olej|margaryn/],
  ['Strączki i roślinne', /ciecierzyc|soczewic|fasol|groch|tofu|hummus|napój (sojowy|migdał|owsian|roślin)|edamame|tempeh/],
  ['Mięso i ryby', /kurczak|indyk|wołow|wieprz|schab|szynk|wędlin|mięso|polędwic|dorsz|łosoś|tuńczyk|pstrąg|makrel|śledź|krewet|mintaj|ryb|boczek|kiełbas/],
  ['Nabiał i jaja', /jaj|mlek|mleko|jogurt|skyr|kefir|maślank|twaróg|twarog|serek|ser |ser$|mozzarell|feta|parmezan|śmietan|masło(?! orzech)|ricotta|halloumi|twarożek|budyń/],
  ['Pieczywo i zboża', /chleb|bułk|tortill|wafl|wafel|płatki|kasz|ryż|makaron|mąk|musli|granol|otręb|pieczyw|tost|bagiet|kuskus|bulgur|komos|grahamk|pita|gnocchi|ciasto do naleśn|amarant|tapiok/],
  ['Owoce', /banan|jabł|grusz|mango|borów|malin|truskaw|wiśni|czereśni|pomarańcz|mandaryn|cytryn|limonk|kiwi|brzoskw|ananas|winogron|śliw|jagod|porzecz|żurawin|rodzyn|daktyl|morel|figi|granat|arbuz|owoc|grejpfrut|marakuj|melon|nektaryn/],
  ['Warzywa', /pomidor|ogór|papryk|cebul|czosn|marchew|cukini|bakłaż|brokuł|kalafior|szpinak|jarmuż|rukol|sałat|roszponk|rzodkiew|por\b|seler|kapust|dyni|burak|pieczark|szczypior|natk|koper|bazyli|kolendr|pietruszk|ziemniak|batat|fasolka|groszek|kukurydz|awokado|oliwk|mięt|imbir|boczniak|kurki|papryczk/],
];

export function ingredientCategory(name: string): string {
  const n = name.toLowerCase();
  if (/(suszon|mielon|granulowan)/.test(n) && /bazyli|kolendr|czosnek|imbir|pietruszk|koper/.test(n)) return 'Przyprawy i sosy';
  return CATS.find(([, rx]) => rx.test(n))?.[0] ?? 'Inne';
}
