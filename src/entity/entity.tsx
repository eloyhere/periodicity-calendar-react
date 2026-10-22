/* eslint-disable @typescript-eslint/no-empty-object-type -- marker interfaces are intentionally empty */
export type Affinity = "Null" | "Integer" | "Real" | "Text" | "Blob";
export type Primitive = null | number | bigint | string | boolean | Uint8Array;
export interface Field {}
export interface Column<F extends Field, P extends Primitive> {
    field?: F;
    value?: P;
    nullable?: boolean;
    unique: boolean;
    defaultValue: "";
}
export interface OneToOne {}
export interface OneToMany {}
export interface ManyToMany {}

export interface Entity<PK extends bigint | number | string> {
    id?: PK;
}
