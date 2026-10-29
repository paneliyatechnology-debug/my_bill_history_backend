export interface CreateNoteDto {
  partyId?: string;
  title: string;
  description?: string;
  descriptions?: string;
}

export interface CreateAppointmentDto {
  partyId?: string;
  title: string;
  description?: string;
  descriptions?: string;
  date: string | Date;
  time: string;
  status?: string;
}
