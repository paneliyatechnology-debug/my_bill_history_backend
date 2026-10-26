export interface LoginDto {
  identifier: string; // Phone or Email
  password: string;
  branchCode?: string;
}
