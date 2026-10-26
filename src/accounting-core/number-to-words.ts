import { Decimal, DecimalLike, toMoney } from "./decimal";

const ONES_EN = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS_EN = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

const ONES_GU = [
  "",
  "એક",
  "બે",
  "ત્રણ",
  "ચાર",
  "પાંચ",
  "છ",
  "સાત",
  "આઠ",
  "નવ",
  "દસ",
  "અગિયાર",
  "બાર",
  "તેર",
  "ચૌદ",
  "પંદર",
  "સોળ",
  "સત્તર",
  "અઢાર",
  "ઓગણીસ",
];

const GUJARATI_NUMBERS_1_TO_99: Record<number, string> = {
  1: "એક",
  2: "બે",
  3: "ત્રણ",
  4: "ચાર",
  5: "પાંચ",
  6: "છ",
  7: "સાત",
  8: "આઠ",
  9: "નવ",
  10: "દસ",
  11: "અગિયાર",
  12: "બાર",
  13: "તેર",
  14: "ચૌદ",
  15: "પંદર",
  16: "સોળ",
  17: "સત્તર",
  18: "અઢાર",
  19: "ઓગણીસ",
  20: "વીસ",
  21: "એકવીસ",
  22: "બાવીસ",
  23: "ત્રેવીસ",
  24: "ચોવીસ",
  25: "પચ્ચીસ",
  26: "છવ્વીસ",
  27: "સત્તાવીસ",
  28: "અઠ્ઠાવીસ",
  29: "ઓગણત્રીસ",
  30: "ત્રીસ",
  31: "એકત્રીસ",
  32: "બત્રીસ",
  33: "તેત્રીસ",
  34: "ચોત્રીસ",
  35: "પાંત્રીસ",
  36: "છત્રીસ",
  37: "સાડત્રીસ",
  38: "આડત્રીસ",
  39: "ઓગણચાલીસ",
  40: "ચાલીસ",
  41: "એકતાલીસ",
  42: "બેતાલીસ",
  43: "તેતાલીસ",
  44: "ચુમ્માલીસ",
  45: "પીસ્તાલીસ",
  46: "છેતાલીસ",
  47: "સુડતાલીસ",
  48: "અડતાલીસ",
  49: "ઓગણપચાસ",
  50: "પચાસ",
  51: "એકાવન",
  52: "બાવન",
  53: "ત્રેપન",
  54: "ચોપન",
  55: "પંચાવન",
  56: "છપ્પન",
  57: "સત્તાવન",
  58: "અઠ્ઠાવન",
  59: "ઓગણસાઠ",
  60: "સાઠ",
  61: "એકસઠ",
  62: "બાસઠ",
  63: "ત્રેસઠ",
  64: "ચોસઠ",
  65: "પાંસઠ",
  66: "છાસઠ",
  67: "સડસઠ",
  68: "અડસઠ",
  69: "અગણોસિત્તેર",
  70: "સિત્તેર",
  71: "એકોતેર",
  72: "બોતેર",
  73: "તોતેર",
  74: "ચુમોતેર",
  75: "પંચોતેર",
  76: "છોતેર",
  77: "સિત્યોતેર",
  78: "ઇઠ્યોતેર",
  79: "ઓગણએંસી",
  80: "એંસી",
  81: "એક્યાસી",
  82: "બ્યાસી",
  83: "ત્યાસી",
  84: "ચોર્યાસી",
  85: "પંચાસી",
  86: "છ્યાસી",
  87: "સિત્યાસી",
  88: "અઠ્યાસી",
  89: "નેવ્યાસી",
  90: "નેવું",
  91: "એકાણું",
  92: "બાણું",
  93: "ત્રાણું",
  94: "ચોરાણું",
  95: "પંચાણું",
  96: "છન્નું",
  97: "સત્તાણું",
  98: "અઠ્ઠાણું",
  99: "નવાણું",
};

function convertBelowThousandEn(n: number): string {
  let str = "";
  if (n >= 100) {
    str += ONES_EN[Math.floor(n / 100)] + " Hundred ";
    n %= 100;
  }
  if (n >= 20) {
    str += TENS_EN[Math.floor(n / 10)] + " ";
    n %= 10;
  }
  if (n > 0) {
    str += ONES_EN[n] + " ";
  }
  return str.trim();
}

function convertBelowThousandGu(n: number): string {
  let str = "";
  if (n >= 100) {
    str += ONES_GU[Math.floor(n / 100)] + " સો ";
    n %= 100;
  }
  if (n > 0) {
    str += (GUJARATI_NUMBERS_1_TO_99[n] || String(n)) + " ";
  }
  return str.trim();
}

/**
 * Converts an integer amount to Indian English currency words (Crores, Lakhs, Thousands)
 */
export function amountToWordsEnglish(amountInput: DecimalLike): string {
  const dec = toMoney(amountInput);
  const total = Math.floor(dec.toNumber());
  if (total === 0) return "Zero Rupees Only";

  let n = total;
  let words = "";

  // Crore (1,00,00,000)
  const crore = Math.floor(n / 10000000);
  if (crore > 0) {
    words += convertBelowThousandEn(crore) + " Crore ";
    n %= 10000000;
  }

  // Lakh (1,00,000)
  const lakh = Math.floor(n / 100000);
  if (lakh > 0) {
    words += convertBelowThousandEn(lakh) + " Lakh ";
    n %= 100000;
  }

  // Thousand (1,000)
  const thousand = Math.floor(n / 1000);
  if (thousand > 0) {
    words += convertBelowThousandEn(thousand) + " Thousand ";
    n %= 1000;
  }

  // Remaining (< 1,000)
  if (n > 0) {
    words += convertBelowThousandEn(n);
  }

  return words.trim() + " Rupees Only";
}

/**
 * Converts an integer amount to Gujarati currency words (અક્ષરે રૂપિયા ... પુરા)
 */
export function amountToWordsGujarati(amountInput: DecimalLike): string {
  const dec = toMoney(amountInput);
  const total = Math.floor(dec.toNumber());
  if (total === 0) return "અક્ષરે રૂપિયા શૂન્ય પુરા";

  let n = total;
  let words = "";

  const crore = Math.floor(n / 10000000);
  if (crore > 0) {
    words += convertBelowThousandGu(crore) + " કરોડ ";
    n %= 10000000;
  }

  const lakh = Math.floor(n / 100000);
  if (lakh > 0) {
    words += convertBelowThousandGu(lakh) + " લાખ ";
    n %= 100000;
  }

  const thousand = Math.floor(n / 1000);
  if (thousand > 0) {
    words += convertBelowThousandGu(thousand) + " હજાર ";
    n %= 1000;
  }

  if (n > 0) {
    words += convertBelowThousandGu(n);
  }

  return "અક્ષરે રૂપિયા " + words.trim() + " પુરા";
}
