declare module 'india-pincode-lookup' {
  interface PincodeRecord {
    officeName: string
    pincode: number
    taluk: string
    districtName: string
    stateName: string
  }
  export function lookup(pincode: string | number): PincodeRecord[]
}
