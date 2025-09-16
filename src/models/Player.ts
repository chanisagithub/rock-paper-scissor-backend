import { Schema, type } from "@colyseus/schema";

export class PlayerSchema extends Schema {
  @type("string") uuid: string = "";
  @type("string") name: string = "";
  @type("string") nftContractAddress?: string;
  @type("string") nftTokenId?: string;
  @type("string") nftImageUrl?: string;
  @type("boolean") connected: boolean = true;
}

