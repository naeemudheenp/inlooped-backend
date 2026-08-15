import { PrismaClient } from '@prisma/client';

export abstract class BaseCrudRepository<T> {
  constructor(protected readonly prisma: PrismaClient, protected readonly model: any) {}

  findOne(where: any, options?: any): Promise<T | null> {
    return this.model.findFirst({ where, ...options });
  }

  findAll(where: any, options?: any): Promise<T[]> {
    return this.model.findMany({ where, ...options });
  }

  create(data: any, options?: any): Promise<T> {
    return this.model.create({ data, ...options });
  }

  update(where: any, data: any, options?: any): Promise<T> {
    return this.model.update({ where, data, ...options });
  }

  delete(where: any): Promise<T> {
    return this.model.delete({ where });
  }

  upsert(where: any, createData: any, updateData: any, options?: any): Promise<T> {
    return this.model.upsert({ where, create: createData, update: updateData, ...options });
  }

  count(where: any): Promise<number> {
    return this.model.count({ where });
  }
}
