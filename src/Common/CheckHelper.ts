﻿export namespace CheckHelper
{
	export function isType(object: unknown, type: any): boolean
	{
		// Check whether typeof of the object is the same as the type string.
		const isTypeOf = typeof type === "string" && typeof object === type;

		// For checking whether an enum value is inside the defined range
		const isPropertyOf = typeof type === "object" && type[object as any];

		// Check if the object is an instance of the specified constructor
		const isInstanceOf = typeof type !== "string" && typeof type !== "object" && object instanceof type;

		return isTypeOf || isInstanceOf || isPropertyOf;
	}
}
