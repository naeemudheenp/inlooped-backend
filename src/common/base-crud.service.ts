export abstract class BaseCrudService<T> {
    constructor(protected readonly repository: any) {}
  
    genericGet(where: any, options?: any): Promise<T | null> {
      return this.repository.findOne(where, options);
    }
  
    genericGetAll(where: any, options?: any): Promise<T[]> {
      return this.repository.findAll(where, options);
    }
  
    genericCreate(data: any): Promise<T> {
      return this.repository.create(data);
    }
  
    genericUpdate(where: any, data: any): Promise<T> {
      return this.repository.update(where, data);
    }
  
    genericDelete(where: any): Promise<T> {
      return this.repository.delete(where);
    }
  
    genericUpsert(where: any, createData: any, updateData: any): Promise<T> {
      return this.repository.upsert(where, createData, updateData);
    }
  
    genericCount(where: any): Promise<number> {
      return this.repository.count(where);
    }
  }
  