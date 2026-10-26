/**
 * Statutory Indian GSTIN and State Code Validator
 * Implements standard Luhn Modulo 36 checksum calculation and state code verification.
 */

export const INDIAN_STATES: Record<
  string,
  { name: string; nameGujarati: string }
> = {
  "01": { name: "Jammu & Kashmir", nameGujarati: "જમ્મુ અને કાશ્મીર" },
  "02": { name: "Himachal Pradesh", nameGujarati: "હિમાચલ પ્રદેશ" },
  "03": { name: "Punjab", nameGujarati: "પંજાબ" },
  "04": { name: "Chandigarh", nameGujarati: "ચંદીગઢ" },
  "05": { name: "Uttarakhand", nameGujarati: "ઉત્તરાખંડ" },
  "06": { name: "Haryana", nameGujarati: "હરિયાણા" },
  "07": { name: "Delhi", nameGujarati: "દિલ્હી" },
  "08": { name: "Rajasthan", nameGujarati: "રાજસ્થાન" },
  "09": { name: "Uttar Pradesh", nameGujarati: "ઉત્તર પ્રદેશ" },
  "10": { name: "Bihar", nameGujarati: "બિહાર" },
  "11": { name: "Sikkim", nameGujarati: "સિક્કિમ" },
  "12": { name: "Arunachal Pradesh", nameGujarati: "અરુણાચલ પ્રદેશ" },
  "13": { name: "Nagaland", nameGujarati: "નાગાલેન્ડ" },
  "14": { name: "Manipur", nameGujarati: "મણિપુર" },
  "15": { name: "Mizoram", nameGujarati: "મિઝોરમ" },
  "16": { name: "Tripura", nameGujarati: "ત્રિપુરા" },
  "17": { name: "Meghalaya", nameGujarati: "મેઘાલય" },
  "18": { name: "Assam", nameGujarati: "આસામ" },
  "19": { name: "West Bengal", nameGujarati: "પશ્ચિમ બંગાળ" },
  "20": { name: "Jharkhand", nameGujarati: "ઝારખંડ" },
  "21": { name: "Odisha", nameGujarati: "ઓડિશા" },
  "22": { name: "Chhattisgarh", nameGujarati: "છત્તીસગઢ" },
  "23": { name: "Madhya Pradesh", nameGujarati: "મધ્ય પ્રદેશ" },
  "24": { name: "Gujarat", nameGujarati: "ગુજરાત" },
  "25": {
    name: "Daman and Diu and Dadra and Nagar Haveli",
    nameGujarati: "દમણ, દીવ અને દાદરા નગર હવેલી",
  },
  "26": { name: "Dadra and Nagar Haveli", nameGujarati: "દાદરા અને નગર હવેલી" },
  "27": { name: "Maharashtra", nameGujarati: "મહારાષ્ટ્ર" },
  "28": { name: "Andhra Pradesh (Old)", nameGujarati: "આંધ્ર પ્રદેશ" },
  "29": { name: "Karnataka", nameGujarati: "કર્ણાટક" },
  "30": { name: "Goa", nameGujarati: "ગોવા" },
  "31": { name: "Lakshadweep", nameGujarati: "લક્ષદ્વીપ" },
  "32": { name: "Kerala", nameGujarati: "કેરળ" },
  "33": { name: "Tamil Nadu", nameGujarati: "તમિલનાડુ" },
  "34": { name: "Puducherry", nameGujarati: "પુડુચેરી" },
  "35": {
    name: "Andaman and Nicobar Islands",
    nameGujarati: "અંદામાન અને નિકોબાર દ્વીપસમૂહ",
  },
  "36": { name: "Telangana", nameGujarati: "તેલંગાણા" },
  "37": { name: "Andhra Pradesh (New)", nameGujarati: "આંધ્ર પ્રદેશ" },
  "38": { name: "Ladakh", nameGujarati: "લદ્દાખ" },
  "96": { name: "Other Countries", nameGujarati: "અન્ય દેશો" },
  "97": { name: "Other Territory", nameGujarati: "અન્ય કેન્દ્રશાસિત પ્રદેશ" },
  "99": { name: "Centre Jurisdiction", nameGujarati: "કેન્દ્ર ન્યાયક્ષેત્ર" },
};

const GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Validates whether a 2-digit code corresponds to an official Indian state or UT.
 */
export function isValidStateCode(stateCode: string): boolean {
  return Boolean(stateCode && INDIAN_STATES[stateCode]);
}

/**
 * Calculates the expected 15th checksum character using standard Luhn Modulo 36.
 */
export function calculateGstinChecksum(gstin14: string): string | null {
  if (!gstin14 || gstin14.length < 14) {
    return null;
  }

  const clean = gstin14.toUpperCase().substring(0, 14);
  let sum = 0;

  for (let i = 0; i < 14; i++) {
    const val = GSTIN_CHARSET.indexOf(clean[i]);
    if (val === -1) {
      return null;
    }
    // Odd positions (0, 2, 4...) weight 1, Even positions (1, 3, 5...) weight 2
    const weight = i % 2 === 0 ? 1 : 2;
    const product = val * weight;
    sum += Math.floor(product / 36) + (product % 36);
  }

  const remainder = sum % 36;
  const checkCode = (36 - remainder) % 36;
  return GSTIN_CHARSET[checkCode];
}

/**
 * Validates a 15-character Indian GSTIN for structure and cryptographic Modulo 36 checksum.
 */
export function isValidGstinChecksum(gstin: string): boolean {
  if (!gstin || gstin.length !== 15) {
    return false;
  }
  const clean = gstin.toUpperCase();
  if (!GSTIN_REGEX.test(clean)) {
    return false;
  }
  const expectedChecksum = calculateGstinChecksum(clean);
  return expectedChecksum === clean[14];
}

export interface GstinValidationResult {
  isValid: boolean;
  error?: string;
  errorGujarati?: string;
  pan?: string;
  derivedStateCode?: string;
}

/**
 * Comprehensive statutory validation for a party's GSTIN and state code.
 */
export function validatePartyGstin(
  gstin: string | undefined | null,
  stateCode: string,
): GstinValidationResult {
  if (!stateCode || !isValidStateCode(stateCode)) {
    return {
      isValid: false,
      error: `Invalid state code '${stateCode}'. Must be a valid 2-digit Indian state code.`,
      errorGujarati: `અમાન્ય રાજ્ય કોડ '${stateCode}'. માન્ય ૨-અંકનો ભારતીય રાજ્ય કોડ હોવો જરૂરી છે.`,
    };
  }

  if (!gstin || gstin.trim() === "") {
    return { isValid: true };
  }

  const cleanGstin = gstin.trim().toUpperCase();

  if (cleanGstin.length !== 15) {
    return {
      isValid: false,
      error: `GSTIN must be exactly 15 characters long. Received: ${cleanGstin.length}.`,
      errorGujarati: `GSTIN બરાબર ૧૫ અક્ષરોનો હોવો જોઈએ. મળેલ: ${cleanGstin.length}.`,
    };
  }

  if (!GSTIN_REGEX.test(cleanGstin)) {
    return {
      isValid: false,
      error: `GSTIN '${cleanGstin}' does not conform to statutory format (2-digit state code + 10-char PAN + 1 entity digit + 'Z' + checksum).`,
      errorGujarati: `GSTIN '${cleanGstin}' કાનૂની ફોર્મેટને અનુરૂપ નથી.`,
    };
  }

  const gstinStatePrefix = cleanGstin.substring(0, 2);
  if (gstinStatePrefix !== stateCode) {
    return {
      isValid: false,
      error: `GSTIN state code prefix '${gstinStatePrefix}' does not match party's state code '${stateCode}'.`,
      errorGujarati: `GSTIN રાજ્ય કોડ પ્રિફિક્સ '${gstinStatePrefix}' પાર્ટીના રાજ્ય કોડ '${stateCode}' સાથે મેળ ખાતો નથી.`,
    };
  }

  const expectedChecksum = calculateGstinChecksum(cleanGstin);
  if (expectedChecksum !== cleanGstin[14]) {
    return {
      isValid: false,
      error: `Invalid GSTIN checksum. Calculated check digit '${expectedChecksum}', but found '${cleanGstin[14]}'.`,
      errorGujarati: `અમાન્ય GSTIN ચેકસમ. ચકાસણી અક્ષર ખોટો છે.`,
    };
  }

  const pan = cleanGstin.substring(2, 12);

  return {
    isValid: true,
    pan,
    derivedStateCode: gstinStatePrefix,
  };
}
