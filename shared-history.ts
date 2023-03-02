import { ChatCompletionRequestMessageRoleEnum } from "openai";
import {
  Table,
  Column,
  Model,
  CreatedAt,
  PrimaryKey,
} from "sequelize-typescript";

@Table
export class SharedHistory extends Model {
  @Column({ primaryKey: true, autoIncrement: true })
  id!: number;

  @Column({ type: "VARCHAR" })
  role!: ChatCompletionRequestMessageRoleEnum;

  @Column
  content!: string;

  @Column
  name!: string;
}
