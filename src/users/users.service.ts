import { Injectable } from '@nestjs/common';
import { BaseCrudService } from '../common/base-crud.service';
import { UserRepository } from './user.repository';

@Injectable()
export class UsersService extends BaseCrudService<any> {
  constructor(private readonly userRepository: UserRepository) {
    super(userRepository);
  }

  async createUser(user: any): Promise<any> {
    return this.userRepository.create(user);
  }
}
 