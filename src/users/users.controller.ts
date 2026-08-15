import { BadRequestException, Controller, HttpException, InternalServerErrorException } from '@nestjs/common';
import { Body, Post } from '@nestjs/common';
import { CreateUserDto } from './users.dto';
import { UsersService } from './users.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';

@Controller('users')
export class UsersController {
    

    constructor(private readonly usersService: UsersService) {}

    @Post('/create')
    async createUser(@Body() user: CreateUserDto): Promise<any> {

       try {
        const email = user.email;
        const password = user.password;

        if(!email || !password) {
            throw new BadRequestException('Email and password are required');
        }

        const isUserExist = await this.usersService.genericGet({ email });

        if(isUserExist) {
            throw new BadRequestException('User already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await this.usersService.genericCreate({ email, password: hashedPassword });

        // Generate token so user is logged in immediately after signup
        const token = jwt.sign({ email: newUser.email, userId: newUser.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

        return ({
            message: 'User created successfully',
            code: 200,
            token: token,
            user: {
                id: newUser.id,
                email: newUser.email
            },
            slackEnabled: false
        });
        
       } catch (error) {
        if (error instanceof HttpException) {
            throw error; // <- return the real error (like BadRequestException)
        }
        throw new InternalServerErrorException('Error creating user');
       }
    }

    @Post('/login')
    async loginUser(@Body() user: CreateUserDto): Promise<any> {
        try {
            const email = user.email;
            const password = user.password;

            if(!email || !password) {
                throw new BadRequestException('Email and password are required');
            }

            const isUserExist = await this.usersService.genericGet({ email });

            if(!isUserExist) {
                throw new UnauthorizedException('User not found');
            }

            const isPasswordValid = await bcrypt.compare(password, isUserExist.password);

            if(!isPasswordValid) {
                throw new UnauthorizedException('Invalid password');
            }

            // Token expires in 30 days - user stays logged in until explicit logout
            const token = jwt.sign({ email: isUserExist.email, userId: isUserExist.id }, process.env.JWT_SECRET, { expiresIn: '30d' });

            // Only ever return the fields the client actually needs. The raw row
            // carries the bcrypt hash and slackAccessToken (a workspace bot
            // token) — neither belongs anywhere near the browser.
            return {
                message: 'User logged in successfully',
                code: 200,
                token: token,
                user: {
                    id: isUserExist.id,
                    email: isUserExist.email,
                    name: isUserExist.name,
                },
                slackEnabled: isUserExist.slackEnabled
            };
        } catch (error) {
            if (error instanceof HttpException) {
                throw error; // <- return the real error (like BadRequestException)
            }
            throw new InternalServerErrorException('Error logging in user');
        }
    }
        
    
}
