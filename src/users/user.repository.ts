import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BaseCrudRepository } from '../common/base-crud.repository';

@Injectable()
export class UserRepository extends BaseCrudRepository<any> {
  constructor(prisma: PrismaService) {
    super(prisma, prisma.users); // prisma.users is the model
  }
}
