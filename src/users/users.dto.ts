import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class CreateUserDto {

    @IsEmail()
    @IsNotEmpty()
    @IsString()
    @MinLength(1)
    @MaxLength(255)
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    @MaxLength(255)
    password: string;
    
}