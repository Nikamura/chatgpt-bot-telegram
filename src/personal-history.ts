import { ChatCompletionRequestMessageRoleEnum } from "openai";
import { Table, Column, Model } from "sequelize-typescript";

@Table({ indexes: [{ fields: ["userId"] }] })
export class PersonalHistory extends Model {
  @Column({ primaryKey: true, autoIncrement: true })
  id!: number;

  @Column
  userId!: number;

  @Column({ type: "VARCHAR" })
  role!: ChatCompletionRequestMessageRoleEnum;

  @Column
  content!: string;

  @Column
  name!: string;
}
