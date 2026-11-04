export type SchoolSourceColumn = { header: string; value: unknown };

export type SchoolRecord = {
  id: string;
  ministry_number: string;
  school_name: string;
  source_columns: SchoolSourceColumn[];
  source_row: number | null;
  latitude: number | null;
  longitude: number | null;
  synced_at: string | null;
  missing_from_sheet_at: string | null;
  plan_scope: boolean;
  size_source: 'small' | 'medium' | 'large' | null;
  size_calc: 'small' | 'medium' | 'large' | null;
  class_count: number | null;
  building_type: string | null;
  has_elevator_contractor: boolean;
};
