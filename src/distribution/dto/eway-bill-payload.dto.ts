export interface EWayBillRequestDto {
  transporterId?: string;
  transporterName?: string;
  transporterDocNo?: string;
  transporterDocDate?: string;
  vehicleNumber?: string;
  vehicleType?: "R" | "O"; // Regular or Over Dimensional Cargo
  distanceKm: number;
}

export interface EWayBillStatusResponse {
  status: "CONFIGURED" | "NOT_CONFIGURED" | "GENERATED" | "CANCELLED";
  ewayBillNumber?: string;
  validUpto?: string;
  payload?: any;
  message: string;
}
