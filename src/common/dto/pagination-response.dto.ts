export interface PaginationMetaDto {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponseDto<T> {
  items: T[];
  pagination: PaginationMetaDto;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export function buildPaginatedResponse<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResponseDto<T> {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Number(limit) || 20);
  const safeTotal = Math.max(0, Number(total) || 0);
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / safeLimit);

  return {
    items,
    pagination: {
      total: safeTotal,
      page: safePage,
      limit: safeLimit,
      totalPages,
    },
    total: safeTotal,
    page: safePage,
    limit: safeLimit,
    totalPages,
  };
}
