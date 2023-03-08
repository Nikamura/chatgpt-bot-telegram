import { ChatCompletionRequestMessageRoleEnum } from "openai";
import {
  Table,
  Column,
  Model,
  CreatedAt,
  PrimaryKey,
} from "sequelize-typescript";

@Table
export class Config extends Model {
  @Column({ primaryKey: true })
  name!: string;

  @Column({ type: "VARCHAR", allowNull: true })
  value!: string | null;
}
